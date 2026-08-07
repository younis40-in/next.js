use std::{collections::BTreeSet, sync::Arc};

use anyhow::Result;
use rustc_hash::{FxHashMap, FxHashSet};
use turbo_rcstr::RcStr;
use turbo_tasks::{FxIndexMap, FxIndexSet, ReadRef, ResolvedVc, TraitRef, TryJoinIterExt, Vc};
use turbo_tasks_fs::FileSystemPath;
use turbo_tasks_hash::{Xxh3Hash64Hasher, encode_base64};
use turbopack_browser::ecmascript::list::content::EcmascriptDevChunkListContent;
use turbopack_core::version::{PartialUpdate, Update, Version, VersionState, VersionedContent};
use turbopack_nodejs::ecmascript::node::entry::chunk_list_content::EcmascriptBuildNodeChunkListContent;

use crate::versioned_content_map::VersionedContentMap;

pub struct HmrChunkWithContent {
    pub path: RcStr,
    pub content: ResolvedVc<Box<dyn VersionedContent>>,
}

/// Whether `content` is a chunk list, i.e. an entry point of the chunk graph that
/// an HMR subscription can be anchored on.
///
/// Note this must enumerate every chunk list content type. A new chunking context
/// that introduces one has to be added here, otherwise its chunks silently drop
/// out of the HMR subscription.
pub fn is_entry_chunk_list_content(content: ResolvedVc<Box<dyn VersionedContent>>) -> bool {
    ResolvedVc::try_downcast_type::<EcmascriptBuildNodeChunkListContent>(content).is_some()
        || ResolvedVc::try_downcast_type::<EcmascriptDevChunkListContent>(content).is_some()
}

/// Per-chunk versions keyed by path
#[turbo_tasks::value(serialization = "skip", shared)]
pub struct AggregateHmrVersion {
    #[turbo_tasks(trace_ignore)]
    pub versions: FxIndexMap<RcStr, TraitRef<Box<dyn Version>>>,
}

#[turbo_tasks::value_impl]
impl Version for AggregateHmrVersion {
    #[turbo_tasks::function]
    async fn id(&self) -> Result<Vc<RcStr>> {
        let entries = self
            .versions
            .iter()
            .map(|(path, version)| {
                let path = path.clone();
                let version = TraitRef::cell(version.clone());
                async move {
                    let id = version.id().owned().await?;
                    Ok::<_, anyhow::Error>((path, id))
                }
            })
            .try_join()
            .await?;

        let mut hasher = Xxh3Hash64Hasher::new();
        hasher.write_value(entries.len());
        for (path, id) in entries {
            hasher.write_value(path.as_str());
            hasher.write_value(id.as_str());
        }
        Ok(Vc::cell(encode_base64(hasher.finish()).into()))
    }
}

impl AggregateHmrVersion {
    pub async fn from_map(
        map: Vc<VersionedContentMap>,
        root: &FileSystemPath,
    ) -> Result<Vc<Box<dyn Version>>> {
        // An empty `versions` map behaves the same as `NotFoundVersion` would in
        // `diff_chunks_against`, so no special case is needed here.
        let chunks = map.hmr_chunks_in_path(root).await?;
        Ok(Vc::upcast(Self::from_chunks(&chunks).await?))
    }

    pub async fn from_chunks(chunks: &[HmrChunkWithContent]) -> Result<Vc<Self>> {
        let versions = chunks
            .iter()
            .map(|HmrChunkWithContent { path, content }| {
                let path = path.clone();
                let content = *content;
                async move {
                    let version = content.version().into_trait_ref().await?;
                    Ok::<_, anyhow::Error>((path, version))
                }
            })
            .try_join()
            .await?
            .into_iter()
            .collect();
        Ok(Self { versions }.cell())
    }
}

/// Aggregates per-entry HMR instructions into a single combined `ChunkListUpdate`.
#[derive(Default)]
pub struct ChunkListUpdateBuilder {
    chunks: FxHashMap<String, serde_json::Value>,
    merged: FxIndexSet<serde_json::Value>,
    affected_entries: BTreeSet<String>,
}

impl ChunkListUpdateBuilder {
    /// Adds an entry's instruction and records that entry when the instruction
    /// contains runtime work. Recording happens before merged instructions are
    /// deduplicated so a shared update retains every owning entry.
    pub fn add_entry_instruction(&mut self, path: &str, instruction: &serde_json::Value) {
        if Self::instruction_has_changes(instruction) {
            self.affected_entries.insert(path.to_owned());
        }
        self.add_instruction(instruction);
    }

    /// Records an entry whose chunk list disappeared from the aggregate.
    pub fn add_affected_entry(&mut self, path: &str) {
        self.affected_entries.insert(path.to_owned());
    }

    fn instruction_has_changes(instruction: &serde_json::Value) -> bool {
        let Some(obj) = instruction.as_object() else {
            return false;
        };
        match obj.get("type").and_then(|value| value.as_str()) {
            Some("ChunkListUpdate") => {
                obj.get("chunks")
                    .and_then(|value| value.as_object())
                    .is_some_and(|chunks| !chunks.is_empty())
                    || obj
                        .get("merged")
                        .and_then(|value| value.as_array())
                        .is_some_and(|updates| updates.iter().any(Self::instruction_has_changes))
            }
            Some("EcmascriptMergedUpdate") => ["entries", "chunks"].iter().any(|key| {
                obj.get(*key)
                    .and_then(|value| value.as_object())
                    .is_some_and(|values| !values.is_empty())
            }),
            _ => false,
        }
    }

    pub fn add_instruction(&mut self, instruction: &serde_json::Value) {
        let Some(obj) = instruction.as_object() else {
            return;
        };
        match obj.get("type").and_then(|v| v.as_str()) {
            Some("ChunkListUpdate") => {
                if let Some(chunks) = obj.get("chunks").and_then(|v| v.as_object()) {
                    for (k, v) in chunks {
                        self.chunks.insert(k.clone(), v.clone());
                    }
                }
                if let Some(merged) = obj.get("merged").and_then(|v| v.as_array()) {
                    for update in merged {
                        self.push_merged(update);
                    }
                }
            }
            Some("EcmascriptMergedUpdate") => {
                self.push_merged(instruction);
            }
            // Unknown instruction shapes are ignored; the caller already
            // escalates `Total`/`Missing` updates to a full restart.
            _ => {}
        }
    }

    fn push_merged(&mut self, update: &serde_json::Value) {
        self.merged.insert(update.clone());
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty() && self.merged.is_empty() && self.affected_entries.is_empty()
    }

    pub fn build(self, to: TraitRef<Box<dyn Version>>) -> Update {
        let mut instruction = serde_json::Map::new();
        instruction.insert(
            "type".to_string(),
            serde_json::Value::String("ChunkListUpdate".to_string()),
        );
        if !self.chunks.is_empty() {
            instruction.insert(
                "chunks".to_string(),
                serde_json::Value::Object(self.chunks.into_iter().collect()),
            );
        }
        if !self.merged.is_empty() {
            instruction.insert(
                "merged".to_string(),
                serde_json::Value::Array(self.merged.into_iter().collect()),
            );
        }
        if !self.affected_entries.is_empty() {
            instruction.insert(
                "affectedEntries".to_string(),
                serde_json::Value::Array(
                    self.affected_entries
                        .into_iter()
                        .map(serde_json::Value::String)
                        .collect(),
                ),
            );
        }
        Update::Partial(PartialUpdate {
            to,
            instruction: Arc::new(serde_json::Value::Object(instruction)),
        })
    }
}

/// Per-chunk [`Update`]s computed against an `AggregateHmrVersion` snapshot.
/// `has_new_chunks` is true when the current snapshot contains chunks absent
/// from `from` (e.g. a new endpoint was written); callers decide whether that
/// affects the batch shape.
pub struct DiffResult {
    pub chunk_updates: Vec<(RcStr, ReadRef<Update>)>,
    pub has_new_chunks: bool,
    pub removed_entries: Vec<RcStr>,
}

fn find_removed_entries<'a, 'b>(
    previous_paths: impl IntoIterator<Item = &'a RcStr>,
    current_paths: impl IntoIterator<Item = &'b RcStr>,
) -> Vec<RcStr> {
    let current_paths = current_paths
        .into_iter()
        .map(|path| path.as_str())
        .collect::<FxHashSet<_>>();
    let mut removed_entries = previous_paths
        .into_iter()
        .filter(|path| !current_paths.contains(path.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    removed_entries.sort_unstable_by(|a, b| a.as_str().cmp(b.as_str()));
    removed_entries
}

/// Diffs each chunk against the [`AggregateHmrVersion`] held by `from`.
///
/// If `from` holds some other kind of `Version`, there's nothing meaningful to
/// diff against, so this returns no updates and leaves it to the caller to
/// decide what to do.
pub async fn diff_chunks_against(
    chunks: &[HmrChunkWithContent],
    from: Vc<VersionState>,
) -> Result<DiffResult> {
    let from_resolved = from.get().to_resolved().await?;
    let Some(from_aggregate) = ResolvedVc::try_downcast_type::<AggregateHmrVersion>(from_resolved)
    else {
        return Ok(DiffResult {
            chunk_updates: Vec::new(),
            has_new_chunks: false,
            removed_entries: Vec::new(),
        });
    };
    let from_aggregate = from_aggregate.await?;
    let removed_entries = find_removed_entries(
        from_aggregate.versions.keys(),
        chunks.iter().map(|chunk| &chunk.path),
    );

    let mut has_new_chunks = false;
    let chunk_updates = chunks
        .iter()
        .filter_map(|HmrChunkWithContent { path, content }| {
            let Some(prev) = from_aggregate.versions.get(path).cloned() else {
                has_new_chunks = true;
                return None;
            };
            Some((path.clone(), *content, TraitRef::cell(prev)))
        })
        .map(|(path, content, prev)| async move {
            let update = content.update(prev).await?;
            Ok::<_, anyhow::Error>((path, update))
        })
        .try_join()
        .await?;
    Ok(DiffResult {
        chunk_updates,
        has_new_chunks,
        removed_entries,
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use turbo_rcstr::RcStr;
    use turbo_tasks::{ResolvedVc, TraitRef};
    use turbo_tasks_backend::{BackendOptions, TurboTasksBackend, noop_backing_storage};
    use turbopack_core::version::{Update, Version};

    use super::{AggregateHmrVersion, ChunkListUpdateBuilder, find_removed_entries};

    #[test]
    fn tracks_all_entries_before_deduplicating_shared_updates() {
        let instruction = json!({
            "type": "EcmascriptMergedUpdate",
            "entries": { "shared": { "code": "updated" } }
        });
        let mut builder = ChunkListUpdateBuilder::default();

        builder.add_entry_instruction("z/route.js", &instruction);
        builder.add_entry_instruction("a/route.js", &instruction);

        assert_eq!(
            builder.affected_entries.into_iter().collect::<Vec<_>>(),
            ["a/route.js", "z/route.js"]
        );
        assert_eq!(builder.merged.len(), 1);
    }

    #[test]
    fn ignores_seed_and_version_only_instructions() {
        let mut builder = ChunkListUpdateBuilder::default();
        builder.add_entry_instruction(
            "one/route.js",
            &json!({
                "type": "ChunkListUpdate",
                "chunks": {},
                "merged": [{ "type": "EcmascriptMergedUpdate" }]
            }),
        );

        assert!(builder.affected_entries.is_empty());
    }

    #[test]
    fn reports_removed_entries_deterministically_including_the_final_entry() {
        let previous = [RcStr::from("z/route.js"), RcStr::from("a/route.js")];
        let current = [RcStr::from("a/route.js")];
        assert_eq!(
            find_removed_entries(previous.iter(), current.iter()),
            [RcStr::from("z/route.js")]
        );

        let no_current_entries: [RcStr; 0] = [];
        assert_eq!(
            find_removed_entries(previous.iter(), no_current_entries.iter()),
            [RcStr::from("a/route.js"), RcStr::from("z/route.js")]
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn affected_entry_only_update_advances_the_version() {
        let tt = turbo_tasks::TurboTasks::new(TurboTasksBackend::new(
            BackendOptions::default(),
            noop_backing_storage(),
        ));
        tt.run_once(async {
            let mut builder = ChunkListUpdateBuilder::default();
            builder.add_affected_entry("app/removed/route.js");

            let to = ResolvedVc::upcast::<Box<dyn Version>>(
                AggregateHmrVersion {
                    versions: Default::default(),
                }
                .resolved_cell(),
            )
            .into_trait_ref()
            .await?;
            let Update::Partial(update) = builder.build(to.clone()) else {
                panic!("an affected-entry-only update must be partial");
            };

            assert!(TraitRef::ptr_eq(&update.to, &to));
            assert_eq!(
                *update.instruction,
                json!({
                    "type": "ChunkListUpdate",
                    "affectedEntries": ["app/removed/route.js"]
                })
            );

            Ok(())
        })
        .await
        .unwrap();
    }
}
