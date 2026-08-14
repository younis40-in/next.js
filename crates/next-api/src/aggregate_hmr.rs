use anyhow::{Result, bail};
use turbo_rcstr::RcStr;
use turbo_tasks::{
    FxIndexMap, FxIndexSet, NonLocalValue, ReadRef, ResolvedVc, TraitRef, TryJoinIterExt, Vc,
    debug::ValueDebugFormat, trace::TraceRawVcs,
};
use turbo_tasks_hash::{Xxh3Hash64Hasher, encode_base64};
use turbopack_browser::ecmascript::list::content::EcmascriptDevChunkListContent;
use turbopack_core::{
    update_instruction::UpdateInstruction,
    version::{PartialUpdate, Update, Version, VersionedContent},
};
use turbopack_ecmascript::chunk_list::{
    merged_update::EcmascriptMergedUpdate,
    update::{ChunkListUpdate, ChunkUpdate, EcmascriptUpdateInstruction},
};
use turbopack_nodejs::ecmascript::node::entry::chunk_list_content::EcmascriptBuildNodeChunkListContent;

#[derive(TraceRawVcs, PartialEq, Eq, ValueDebugFormat, NonLocalValue)]
pub struct HmrChunkWithContent {
    pub path: RcStr,
    pub content: ResolvedVc<Box<dyn VersionedContent>>,
}

#[turbo_tasks::value(transparent, serialization = "skip")]
pub struct HmrChunksWithContent(Vec<HmrChunkWithContent>);

/// Whether `content` is a chunk list, i.e. an entry point of the chunk graph that
/// an aggregate HMR session can be anchored on.
///
/// Note this must enumerate every chunk list content type. A new chunking context
/// that introduces one has to be added here, otherwise its chunks silently drop
/// out of aggregate HMR updates.
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
    chunks: FxIndexMap<RcStr, ChunkUpdate>,
    merged: FxIndexSet<EcmascriptMergedUpdate>,
}

impl ChunkListUpdateBuilder {
    pub fn add_instruction(&mut self, instruction: &UpdateInstruction) -> Result<()> {
        let Some(instruction) = instruction.downcast_ref::<EcmascriptUpdateInstruction>() else {
            bail!("aggregate HMR only accepts ECMAScript update instructions")
        };

        match instruction {
            EcmascriptUpdateInstruction::ChunkList(update) => {
                for (chunk_path, update) in &update.chunks {
                    self.chunks.insert(chunk_path.clone(), update.clone());
                }
                for update in &update.merged {
                    self.push_merged(update);
                }
            }
            EcmascriptUpdateInstruction::Merged(update) => self.push_merged(update),
        }

        Ok(())
    }

    fn push_merged(&mut self, update: &EcmascriptMergedUpdate) {
        self.merged.insert(update.clone());
    }

    pub fn is_empty(&self) -> bool {
        self.chunks.is_empty() && self.merged.is_empty()
    }

    pub fn build(self) -> UpdateInstruction {
        ChunkListUpdate {
            chunks: self.chunks,
            merged: self.merged.into_iter().collect(),
        }
        .into_instruction()
    }
}

/// Outcome of a server HMR pull: what the caller has to do, and the version to
/// diff the next pull against.
///
/// Distinct from [`Update`] because that type cannot express "nothing to apply,
/// but remember this version", which is what the first pull of a session and a
/// newly appearing endpoint both produce.
#[derive(Debug, TraceRawVcs, NonLocalValue)]
pub enum ServerHmrUpdate {
    /// Nothing changed and there is no new version to remember.
    None,
    /// Nothing to apply, but `to` has to be remembered so the next pull diffs
    /// against it.
    Version {
        #[turbo_tasks(trace_ignore)]
        to: TraitRef<Box<dyn Version>>,
    },
    /// Can't be applied incrementally; re-evaluate from disk.
    Restart {
        #[turbo_tasks(trace_ignore)]
        to: TraitRef<Box<dyn Version>>,
    },
    /// `instruction` patches the running module graph in place.
    Partial {
        #[turbo_tasks(trace_ignore)]
        to: TraitRef<Box<dyn Version>>,
        instruction: UpdateInstruction,
    },
}

/// Per-chunk [`Update`]s computed against an `AggregateHmrVersion` snapshot.
/// `has_new_chunks` is true when the current snapshot contains chunks absent
/// from `from` (e.g. a new endpoint was written); callers decide whether that
/// affects the batch shape.
pub struct DiffResult {
    pub chunk_updates: Vec<(RcStr, ReadRef<Update>)>,
    pub has_new_chunks: bool,
}

/// Diffs each chunk against `from`.
///
/// If `from` is not an [`AggregateHmrVersion`], there's nothing meaningful to
/// diff against, so this returns no updates and leaves it to the caller to
/// decide what to do.
pub async fn diff_chunks_against(
    chunks: &[HmrChunkWithContent],
    from: Vc<Box<dyn Version>>,
) -> Result<DiffResult> {
    if chunks.is_empty() {
        return Ok(DiffResult {
            chunk_updates: Vec::new(),
            has_new_chunks: false,
        });
    }
    let from_resolved = from.to_resolved().await?;
    let Some(from_aggregate) = ResolvedVc::try_downcast_type::<AggregateHmrVersion>(from_resolved)
    else {
        return Ok(DiffResult {
            chunk_updates: Vec::new(),
            has_new_chunks: false,
        });
    };
    let from_aggregate = from_aggregate.await?;

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
    })
}

#[cfg(test)]
mod tests {
    use anyhow::Result;
    use turbo_tasks::{FxIndexMap, FxIndexSet};
    use turbopack_core::update_instruction::UpdateInstruction;
    use turbopack_ecmascript::chunk_list::{
        merged_update::{
            EcmascriptMergedChunkDeleted, EcmascriptMergedChunkUpdate, EcmascriptMergedUpdate,
        },
        update::{ChunkListUpdate, ChunkUpdate, EcmascriptUpdateInstruction},
    };

    use super::ChunkListUpdateBuilder;

    fn merged(chunk_path: &str) -> EcmascriptMergedUpdate {
        EcmascriptMergedUpdate {
            entries: Default::default(),
            chunks: [(
                chunk_path.into(),
                EcmascriptMergedChunkUpdate::Deleted(EcmascriptMergedChunkDeleted {
                    modules: Default::default(),
                }),
            )]
            .into_iter()
            .collect(),
        }
    }

    #[test]
    fn deduplicates_merged_updates_in_first_seen_order() -> Result<()> {
        let first = merged("first.js");
        let second = merged("second.js");
        let mut builder = ChunkListUpdateBuilder::default();

        builder.add_instruction(&UpdateInstruction::new(
            EcmascriptUpdateInstruction::Merged(first.clone()),
        ))?;
        builder.add_instruction(&UpdateInstruction::new(
            EcmascriptUpdateInstruction::Merged(second.clone()),
        ))?;
        builder.add_instruction(&UpdateInstruction::new(
            EcmascriptUpdateInstruction::Merged(first.clone()),
        ))?;

        assert_eq!(builder.merged, FxIndexSet::from_iter([first, second]));
        Ok(())
    }

    #[test]
    fn chunk_updates_use_last_writer_and_stable_order() -> Result<()> {
        let mut builder = ChunkListUpdateBuilder::default();
        let first = ChunkListUpdate {
            chunks: FxIndexMap::from_iter([
                ("a.js".into(), ChunkUpdate::Total),
                ("b.js".into(), ChunkUpdate::Added),
            ]),
            merged: vec![],
        };
        let second = ChunkListUpdate {
            chunks: FxIndexMap::from_iter([
                ("a.js".into(), ChunkUpdate::Deleted),
                ("c.js".into(), ChunkUpdate::Total),
            ]),
            merged: vec![],
        };

        builder.add_instruction(&first.into_instruction())?;
        builder.add_instruction(&second.into_instruction())?;

        assert_eq!(
            builder
                .chunks
                .keys()
                .map(|path| path.as_str())
                .collect::<Vec<_>>(),
            ["a.js", "b.js", "c.js"]
        );
        assert_eq!(builder.chunks["a.js"], ChunkUpdate::Deleted);
        Ok(())
    }
}

/// Diffs `chunks` against `from` and folds the per-chunk updates into one
/// [`ServerHmrUpdate`].
///
/// Deliberately *not* a `#[turbo_tasks::function]`. Keyed on `from`, it would
/// mint a task per pull; those tasks would be reachable from a `root` wrapper
/// whose activeness outlives the pull, so each superseded one would re-execute
/// on every later change. Run here instead, as a child of the caller's transient
/// once-task, the work is dropped when that task ends.
///
/// Each tracked entry chunk's own update is a `ChunkListUpdate` (carrying the
/// module deltas for its shared chunks via the merger) or a bare
/// `EcmascriptMergedUpdate`; both are folded into one `ChunkListUpdate` that the
/// runtime applies exactly as it would a single chunk list.
///
/// All-or-nothing restart: any chunk needing `Total`/`Missing` escalates the
/// whole batch to `Total` (the runtime can't partially restart). New chunks
/// absent from `from` are skipped; the runtime require()s them on demand.
///
/// `from` is supplied by the caller, which owns the last version it was handed
/// (see the returned update's `to`). A caller with no version yet passes
/// [`turbopack_core::version::NotFoundVersion`]: nothing diffs against it, so
/// that pull reports no changes and only serves to hand back the current
/// version.
pub async fn compute_server_hmr_update(
    chunks: &[HmrChunkWithContent],
    from: Vc<Box<dyn Version>>,
) -> Result<ServerHmrUpdate> {
    // No chunks to diff yet (e.g. before any endpoints have been written).
    if chunks.is_empty() {
        return Ok(ServerHmrUpdate::None);
    }

    // Build `to` up front so we can return it on every escape hatch below.
    let to_aggregate = AggregateHmrVersion::from_chunks(chunks).await?;
    let to_ref = Vc::upcast::<Box<dyn Version>>(to_aggregate)
        .into_trait_ref()
        .await?;

    let DiffResult {
        chunk_updates,
        has_new_chunks,
    } = diff_chunks_against(chunks, from).await?;

    // Nothing to apply, but `from` still needs to advance to `to`. Reaching here
    // means `from` held a version we couldn't diff against (it wasn't an
    // `AggregateHmrVersion`), so `diff_chunks_against` gave up and returned
    // nothing. Advancing the caller forward makes the *next* change produce a
    // real diff; reporting a restart instead would force a needless full
    // re-evaluation.
    if chunk_updates.is_empty() && !has_new_chunks {
        return Ok(ServerHmrUpdate::Version { to: to_ref });
    }

    let mut builder = ChunkListUpdateBuilder::default();
    for (_path, update) in chunk_updates {
        match &*update {
            Update::None => {}
            Update::Missing | Update::Total(_) => {
                return Ok(ServerHmrUpdate::Restart { to: to_ref });
            }
            Update::Partial(PartialUpdate { instruction, .. }) => {
                builder.add_instruction(instruction)?;
            }
        }
    }

    // A new chunk still advances the version even with nothing to apply: the
    // runtime require()s it on demand.
    if builder.is_empty() {
        return Ok(if has_new_chunks {
            ServerHmrUpdate::Version { to: to_ref }
        } else {
            ServerHmrUpdate::None
        });
    }

    Ok(ServerHmrUpdate::Partial {
        to: to_ref,
        instruction: builder.build(),
    })
}
