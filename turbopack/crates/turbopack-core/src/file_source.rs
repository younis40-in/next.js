use anyhow::{Result, bail};
use turbo_rcstr::RcStr;
use turbo_tasks::Vc;
use turbo_tasks_fs::{
    FileContent, FileSystemEntryType, FileSystemPath, LinkContent, LinkTarget, WriteLinkTarget,
};

use crate::{
    asset::{Asset, AssetContent},
    ident::AssetIdent,
    source::Source,
};

/// The raw [Source]. It represents raw content from a path without any
/// references to other [Source]s.
#[turbo_tasks::value]
pub struct FileSource {
    path: FileSystemPath,
    query: RcStr,
    fragment: RcStr,
}

impl FileSource {
    pub fn new(path: FileSystemPath) -> Vc<Self> {
        FileSource::new_with_query_and_fragment(path, RcStr::default(), RcStr::default())
    }
    pub fn new_with_query(path: FileSystemPath, query: RcStr) -> Vc<Self> {
        FileSource::new_with_query_and_fragment(path, query, RcStr::default())
    }
}

#[turbo_tasks::value_impl]
impl FileSource {
    #[turbo_tasks::function]
    pub fn new_with_query_and_fragment(
        path: FileSystemPath,
        query: RcStr,
        fragment: RcStr,
    ) -> Vc<Self> {
        Self::cell(FileSource {
            path,
            query,
            fragment,
        })
    }
}

#[turbo_tasks::value_impl]
impl Source for FileSource {
    #[turbo_tasks::function]
    fn ident(&self) -> Vc<AssetIdent> {
        AssetIdent::from_path(self.path.clone())
            .with_query(self.query.clone())
            .with_fragment(self.fragment.clone())
            .into_vc()
    }

    #[turbo_tasks::function]
    fn description(&self) -> Vc<RcStr> {
        Vc::cell(format!("file content of {}", self.path).into())
    }
}

#[turbo_tasks::value_impl]
impl Asset for FileSource {
    #[turbo_tasks::function]
    async fn content(&self) -> Result<Vc<AssetContent>> {
        let file_type = &*self.path.get_type().await?;
        match file_type {
            FileSystemEntryType::Symlink => match &*self.path.read_link().await? {
                LinkContent::Link { target } => {
                    // Recreate the link with its original spelling, so a relative link stays
                    // relative. `is_directory` is only needed so that it can be recreated on
                    // Windows, where directory links must be junction points.
                    let write_target = match target {
                        // An absolute target is written back from the filesystem root, which is
                        // exactly how the resolved path is stored.
                        LinkTarget::Absolute { resolved } => {
                            WriteLinkTarget::Absolute(resolved.path.clone())
                        }
                        LinkTarget::Relative { raw, .. } => WriteLinkTarget::Relative(raw.clone()),
                    };
                    Ok(AssetContent::Redirect {
                        target: write_target,
                        is_directory: matches!(
                            target.target_type().await?,
                            FileSystemEntryType::Directory
                        ),
                    }
                    .cell())
                }
                _ => bail!("Invalid symlink"),
            },
            FileSystemEntryType::File => {
                Ok(AssetContent::File(self.path.read().to_resolved().await?).cell())
            }
            FileSystemEntryType::NotFound => {
                Ok(AssetContent::File(FileContent::NotFound.resolved_cell()).cell())
            }
            _ => bail!("Invalid file type {:?}", file_type),
        }
    }
}
