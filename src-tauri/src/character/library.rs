//! Installed packs under `%APPDATA%/itsumo-desk/characters/<id>/` and imports in progress
//! under `characters/.staging/<token>/`. Every method touches the disk; call them off the
//! async runtime.

use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, PoisonError,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use tracing::warn;

use super::{
    import::{self, Source},
    manifest::ModelManifest,
    mapping::{self, Mapping},
    pack::{self, CharacterJson, CHARACTER_FILE, ICON_FILE, MANIFEST_FILE},
    paths::is_valid_id,
    protocol, ActiveCharacter, CharacterError, CharacterSummary, ImportReview, StagedImport,
};

pub const STAGING: &str = ".staging";

/// An import waiting for the user's review and confirmation.
struct Staged {
    character: CharacterJson,
    mapping: Option<Mapping>,
    warnings: Vec<String>,
    /// Set once the webview sent the manifest; committing needs it.
    reviewed: bool,
}

pub struct CharacterLibrary {
    root: PathBuf,
    staged: Mutex<HashMap<String, Staged>>,
    next_token: AtomicU64,
}

/// Tokens are lower-case hex, so they cannot collide with the staging folder's other names.
pub fn is_valid_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 32
        && token
            .chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn url_base(base: &[&str], relative: &str) -> String {
    protocol::url(base.iter().copied().chain(relative.split('/')))
}

fn summary(dir: &Path, base: &[&str], character: &CharacterJson, id: &str) -> CharacterSummary {
    CharacterSummary {
        id: id.to_owned(),
        name: character.name.clone(),
        author: character.author.clone(),
        license: character.license.clone(),
        icon_url: dir
            .join(ICON_FILE)
            .is_file()
            .then(|| url_base(base, ICON_FILE)),
    }
}

fn remove_quietly(dir: &Path) {
    if let Err(error) = fs::remove_dir_all(dir) {
        if error.kind() != io::ErrorKind::NotFound {
            warn!(%error, "could not remove a staging folder");
        }
    }
}

impl CharacterLibrary {
    /// Creates the folder if needed and clears imports left over from a previous run.
    pub fn open(root: PathBuf) -> Self {
        if let Err(error) = fs::create_dir_all(&root) {
            warn!(%error, "could not create the characters folder");
        }
        remove_quietly(&root.join(STAGING));
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_secs());
        Self {
            root,
            staged: Mutex::default(),
            next_token: AtomicU64::new(seed << 16),
        }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn staged(&self) -> std::sync::MutexGuard<'_, HashMap<String, Staged>> {
        self.staged.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn staging(&self, token: &str) -> PathBuf {
        self.root.join(STAGING).join(token)
    }

    fn installed_dir(&self, id: &str) -> Option<PathBuf> {
        let dir = self.root.join(id);
        (is_valid_id(id) && dir.join(CHARACTER_FILE).is_file()).then_some(dir)
    }

    pub fn is_installed(&self, id: &str) -> bool {
        self.installed_dir(id).is_some()
    }

    fn read_installed(&self, id: &str) -> Option<(PathBuf, CharacterJson)> {
        let dir = self.installed_dir(id)?;
        match pack::read_character(&dir) {
            Ok((character, _)) => Some((dir, character)),
            Err(error) => {
                warn!(%error, id, "skipping an unreadable character pack");
                None
            }
        }
    }

    /// Installed packs, by name. Unreadable ones are skipped.
    pub fn list(&self) -> Vec<CharacterSummary> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) => {
                warn!(%error, "could not list the characters folder");
                return Vec::new();
            }
        };
        let mut characters: Vec<_> = entries
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
            .filter_map(|id| {
                let (dir, character) = self.read_installed(&id)?;
                Some(summary(&dir, &[&id], &character, &id))
            })
            .collect();
        characters.sort_by_cached_key(|c| (c.name.to_lowercase(), c.id.clone()));
        characters
    }

    /// What the companion needs to load an installed character.
    pub fn active(&self, id: &str) -> Option<ActiveCharacter> {
        let (_, character) = self.read_installed(id)?;
        Some(ActiveCharacter {
            id: id.to_owned(),
            name: character.name,
            model_url: url_base(&[id], &character.model),
            extras: character.extras,
        })
    }

    /// Builds and validates a pack from `source` in a new staging folder.
    pub fn stage(&self, source: &Source) -> Result<StagedImport, CharacterError> {
        let token = format!("{:x}", self.next_token.fetch_add(1, Ordering::Relaxed));
        let dir = self.staging(&token);
        let result = import::stage(source, &dir, &|id| self.is_installed(id))
            .and_then(|()| pack::validate(&dir));
        let valid = match result {
            Ok(valid) => valid,
            Err(error) => {
                remove_quietly(&dir);
                return Err(error);
            }
        };
        let base = [STAGING, token.as_str()];
        let character = &valid.character;
        let staged = StagedImport {
            token: token.clone(),
            character: summary(&dir, &base, character, &character.id),
            model_url: url_base(&base, &character.model),
            extras: character.extras.clone(),
            warnings: valid.warnings.clone(),
        };
        self.staged().insert(
            token,
            Staged {
                character: valid.character,
                mapping: valid.mapping,
                warnings: valid.warnings,
                reviewed: false,
            },
        );
        Ok(staged)
    }

    /// Checks the mapping against the manifest the webview built and caches the manifest in
    /// the pack.
    pub fn review(
        &self,
        token: &str,
        manifest: &ModelManifest,
    ) -> Result<ImportReview, CharacterError> {
        let json = serde_json::to_vec_pretty(manifest)
            .map_err(|e| CharacterError::InvalidPack(e.to_string()))?;
        fs::write(self.staging(token).join(MANIFEST_FILE), json)
            .map_err(|e| CharacterError::io(MANIFEST_FILE, e))?;

        let mut staged = self.staged();
        let entry = staged.get_mut(token).ok_or(CharacterError::UnknownImport)?;
        let mut warnings = entry.warnings.clone();
        if let Some(mapping) = &entry.mapping {
            warnings.extend(mapping::check(mapping, manifest));
        }
        entry.reviewed = true;
        let replaces = self
            .read_installed(&entry.character.id)
            .map(|(_, installed)| installed.name);
        Ok(ImportReview { warnings, replaces })
    }

    /// Moves a reviewed import into place. An installed pack with the same id is replaced
    /// only when `replace` is set. Returns the new pack's id.
    pub fn commit(&self, token: &str, replace: bool) -> Result<String, CharacterError> {
        let staged = self
            .staged()
            .remove(token)
            .ok_or(CharacterError::UnknownImport)?;
        let dir = self.staging(token);
        if !staged.reviewed {
            remove_quietly(&dir);
            return Err(CharacterError::UnknownImport);
        }
        let id = staged.character.id;
        let target = self.root.join(&id);
        let io = |e| CharacterError::io("the characters folder", e);
        if target.exists() {
            if !replace {
                remove_quietly(&dir);
                return Err(CharacterError::Conflict(id));
            }
            let old = self.root.join(STAGING).join(format!("{token}-old"));
            fs::rename(&target, &old).map_err(io)?;
            if let Err(error) = fs::rename(&dir, &target) {
                if let Err(restore) = fs::rename(&old, &target) {
                    warn!(%restore, "could not restore the replaced character");
                }
                return Err(io(error));
            }
            remove_quietly(&old);
        } else {
            fs::rename(&dir, &target).map_err(io)?;
        }
        Ok(id)
    }

    pub fn cancel(&self, token: &str) {
        self.staged().remove(token);
        remove_quietly(&self.staging(token));
    }

    /// Deletes an installed pack. It is moved aside first, so a delete that fails half way
    /// never leaves a broken pack in the list; leftovers go with the next startup.
    pub fn remove(&self, id: &str) -> Result<(), CharacterError> {
        let dir = self
            .installed_dir(id)
            .ok_or_else(|| CharacterError::UnknownCharacter(id.to_owned()))?;
        let token = format!("{:x}", self.next_token.fetch_add(1, Ordering::Relaxed));
        let aside = self.root.join(STAGING).join(format!("{token}-removed"));
        let io = |e| CharacterError::io("the characters folder", e);
        fs::create_dir_all(self.root.join(STAGING)).map_err(io)?;
        fs::rename(dir, &aside).map_err(io)?;
        remove_quietly(&aside);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::character::test_dir::TestDir;

    fn model_folder(dir: &Path, stem: &str) -> PathBuf {
        fs::create_dir_all(dir).expect("create dir");
        let model3 = dir.join(format!("{stem}.model3.json"));
        let json = json!({ "FileReferences": { "Moc": "m.moc3", "Textures": ["t.png"] } });
        fs::write(&model3, json.to_string()).expect("write model3");
        fs::write(dir.join("m.moc3"), b"moc").expect("write moc");
        fs::write(dir.join("t.png"), b"png").expect("write texture");
        model3
    }

    fn manifest() -> ModelManifest {
        ModelManifest {
            parameters: vec![],
            expressions: vec![],
            motion_groups: vec![],
            hit_areas: vec![],
            standard_parameters: vec![],
            eye_blink_ids: vec![],
            lip_sync_ids: vec![],
        }
    }

    #[test]
    fn stage_review_commit_installs_and_lists() {
        let tmp = TestDir::new("library-install");
        let library = CharacterLibrary::open(tmp.path("characters"));
        let model3 = model_folder(&tmp.path("source"), "Hiyori");

        let staged = library
            .stage(&Source::File(model3.clone()))
            .expect("staged");
        assert_eq!(staged.character.id, "hiyori");
        assert!(staged.model_url.contains("/.staging/"));
        // Committing before the review is refused.
        assert!(library.commit(&staged.token, false).is_err());

        let staged = library
            .stage(&Source::File(model3.clone()))
            .expect("staged again");
        let review = library
            .review(&staged.token, &manifest())
            .expect("reviewed");
        assert_eq!(review.replaces, None);
        assert_eq!(
            library.commit(&staged.token, false).expect("committed"),
            "hiyori"
        );
        assert!(tmp.path("characters/hiyori/manifest.json").is_file());

        let list = library.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "Hiyori");
        let active = library.active("hiyori").expect("installed");
        assert!(active
            .model_url
            .ends_with("/hiyori/model/Hiyori.model3.json"));

        // A second import of the same bare model becomes a copy, not a replacement.
        let again = library.stage(&Source::File(model3)).expect("staged copy");
        assert_eq!(again.character.id, "hiyori-2");
        library.cancel(&again.token);
        assert!(!library.staging(&again.token).exists());
    }

    #[test]
    fn a_pack_with_an_installed_id_replaces_only_when_asked() {
        let tmp = TestDir::new("library-replace");
        let library = CharacterLibrary::open(tmp.path("characters"));
        let source = tmp.path("pack");
        model_folder(&source.join("model"), "m");
        let character = |name: &str| {
            let json =
                json!({ "schema": 1, "id": "mine", "name": name, "model": "model/m.model3.json" });
            fs::write(source.join("character.json"), json.to_string())
                .expect("write character.json");
        };

        character("First");
        let staged = library
            .stage(&Source::Folder(source.clone()))
            .expect("staged");
        library
            .review(&staged.token, &manifest())
            .expect("reviewed");
        library.commit(&staged.token, false).expect("committed");

        character("Second");
        let staged = library
            .stage(&Source::Folder(source.clone()))
            .expect("staged");
        let review = library
            .review(&staged.token, &manifest())
            .expect("reviewed");
        assert_eq!(review.replaces.as_deref(), Some("First"));
        assert!(matches!(
            library.commit(&staged.token, false),
            Err(CharacterError::Conflict(_))
        ));

        let staged = library.stage(&Source::Folder(source)).expect("staged");
        library
            .review(&staged.token, &manifest())
            .expect("reviewed");
        library.commit(&staged.token, true).expect("replaced");
        assert_eq!(library.list()[0].name, "Second");
    }

    #[test]
    fn remove_deletes_the_pack() {
        let tmp = TestDir::new("library-remove");
        let library = CharacterLibrary::open(tmp.path("characters"));
        let staged = library
            .stage(&Source::File(model_folder(&tmp.path("source"), "m")))
            .expect("staged");
        library
            .review(&staged.token, &manifest())
            .expect("reviewed");
        library.commit(&staged.token, false).expect("committed");

        library.remove("m").expect("removed");
        assert!(library.list().is_empty());
        assert!(!tmp.path("characters/m").exists());
        assert!(matches!(
            library.remove("m"),
            Err(CharacterError::UnknownCharacter(_))
        ));
    }

    #[test]
    fn leftover_staging_is_cleared_on_open() {
        let tmp = TestDir::new("library-leftovers");
        let leftover = tmp.path("characters/.staging/abc/model");
        fs::create_dir_all(&leftover).expect("create leftover");
        CharacterLibrary::open(tmp.path("characters"));
        assert!(!tmp.path("characters/.staging").exists());
    }

    #[test]
    fn tokens_are_hex() {
        assert!(is_valid_token("18f3a0000"));
        assert!(!is_valid_token(""));
        assert!(!is_valid_token("../x"));
        assert!(!is_valid_token("ABC"));
    }
}
