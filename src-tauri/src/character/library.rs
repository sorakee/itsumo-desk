//! Installed packs under `%APPDATA%/itsumo-desk/characters/<id>/` and imports in progress
//! under `characters/.staging/<token>/`. Every method touches the disk; call them off the
//! async runtime.

use std::{
    collections::{BTreeMap, HashMap},
    fs, io,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, PoisonError,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use tracing::{debug, warn};

use crate::settings::CharacterSettings;

use super::{
    import::{self, Origin, Source, VTUBE_SUFFIX},
    manifest::ModelManifest,
    mapping::{self, Mapping},
    model3::{self, ModelFiles},
    pack::{
        self, read_json, CharacterJson, CHARACTER_FILE, ICON_FILE, MANIFEST_FILE, MAPPING_FILE,
        USER_MAPPING_FILE,
    },
    paths::is_valid_id,
    prefill, protocol, ActiveCharacter, CharacterError, CharacterMapping, CharacterSummary,
    ImportReview, StagedImport,
};

pub const STAGING: &str = ".staging";

/// An import waiting for the user's review and confirmation.
struct Staged {
    character: CharacterJson,
    origin: Origin,
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

/// The user's preferences for each character, by id.
type Preferences = BTreeMap<String, CharacterSettings>;

fn display_name(character: &CharacterJson, preferences: Option<&CharacterSettings>) -> String {
    preferences
        .and_then(|p| p.display_name.clone())
        .unwrap_or_else(|| character.name.clone())
}

fn summary(
    dir: &Path,
    base: &[&str],
    character: &CharacterJson,
    id: &str,
    preferences: Option<&CharacterSettings>,
) -> CharacterSummary {
    CharacterSummary {
        id: id.to_owned(),
        name: display_name(character, preferences),
        pack_name: character.name.clone(),
        favorite: preferences.is_some_and(|p| p.favorite),
        author: character.author.clone(),
        license: character.license.clone(),
        icon_url: dir
            .join(ICON_FILE)
            .is_file()
            .then(|| url_base(base, ICON_FILE)),
    }
}

/// The mapping in effect for a pack.
struct EffectiveMapping {
    /// `None` if the pack has no usable mapping.
    mapping: Option<Mapping>,
    /// For whatever the parse dropped.
    warnings: Vec<String>,
    /// Whether the user's edits (`mapping.user.json`) exist; they apply unless unreadable.
    customized: bool,
}

/// Reads the user's edits to a pack's mapping if there are any (D45), else its own
/// `mapping.json`. An unreadable `mapping.user.json` falls back to the pack's with a warning.
fn effective_mapping(dir: &Path) -> EffectiveMapping {
    let mut warnings = Vec::new();
    let user = dir.join(USER_MAPPING_FILE);
    let customized = user.is_file();
    let mut read = |path: &Path| match pack::read_mapping(path) {
        Ok((mapping, parse_warnings)) => {
            warnings.extend(parse_warnings);
            Some(mapping)
        }
        Err(error) => {
            warnings.push(error.to_string());
            None
        }
    };
    let mut mapping = customized.then(|| read(&user)).flatten();
    if mapping.is_none() {
        let own = dir.join(MAPPING_FILE);
        mapping = own.is_file().then(|| read(&own)).flatten();
    }
    EffectiveMapping {
        mapping,
        warnings,
        customized,
    }
}

/// The `.vtube.json` VTube Studio keeps beside a model, if any.
fn vtube_json(model_dir: &Path) -> Option<Value> {
    let entry = fs::read_dir(model_dir)
        .ok()?
        .filter_map(Result::ok)
        .find(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.to_lowercase().ends_with(VTUBE_SUFFIX))
        })?;
    read_json(&entry.path()).ok()
}

/// A mapping suggested from the model's names and its `.vtube.json` (prefill, D45). An
/// unreadable `model3.json` or `.vtube.json` only means fewer suggestions.
fn suggestions(dir: &Path, character: &CharacterJson, manifest: &ModelManifest) -> Mapping {
    let files = read_json(&dir.join(&character.model))
        .and_then(|json| model3::parse(&json))
        .unwrap_or_else(|error| {
            debug!(%error, "suggesting without the model's file list");
            ModelFiles::default()
        });
    let vtube = vtube_json(&dir.join(character.model_dir()));
    prefill::suggest(manifest, &files, &character.extras, vtube.as_ref())
}

fn read_manifest(dir: &Path) -> Result<ModelManifest, CharacterError> {
    serde_json::from_value(pack::read_json(&dir.join(MANIFEST_FILE))?)
        .map_err(|e| CharacterError::InvalidPack(e.to_string()))
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

    /// The name in an installed pack's `character.json`.
    pub fn pack_name(&self, id: &str) -> Result<String, CharacterError> {
        self.read_installed(id)
            .map(|(_, character)| character.name)
            .ok_or_else(|| CharacterError::UnknownCharacter(id.to_owned()))
    }

    /// Installed packs, by display name. Unreadable ones are skipped.
    pub fn list(&self, preferences: &Preferences) -> Vec<CharacterSummary> {
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
                Some(summary(&dir, &[&id], &character, &id, preferences.get(&id)))
            })
            .collect();
        characters.sort_by_cached_key(|c| (c.name.to_lowercase(), c.id.clone()));
        characters
    }

    /// What the companion needs to load an installed character.
    pub fn active(&self, id: &str) -> Option<ActiveCharacter> {
        let (dir, character) = self.read_installed(id)?;
        let effective = effective_mapping(&dir);
        if !effective.warnings.is_empty() {
            debug!(id, warnings = ?effective.warnings, "the active mapping has problems");
        }
        Some(ActiveCharacter {
            id: id.to_owned(),
            model_url: url_base(&[id], &character.model),
            extras: character.extras,
            mapping: effective.mapping,
        })
    }

    /// An installed character's mapping, with warnings for whatever in it was dropped or
    /// points at something the model lacks.
    pub fn mapping(&self, id: &str) -> Result<CharacterMapping, CharacterError> {
        let (dir, character) = self
            .read_installed(id)
            .ok_or_else(|| CharacterError::UnknownCharacter(id.to_owned()))?;
        let EffectiveMapping {
            mapping,
            mut warnings,
            customized,
        } = effective_mapping(&dir);
        // Cached at import; without it the targets go unchecked and nothing is suggested.
        let manifest = read_manifest(&dir)
            .inspect_err(|error| warn!(%error, id, "could not read the cached manifest"))
            .ok();
        if let (Some(mapping), Some(manifest)) = (&mapping, &manifest) {
            warnings.extend(mapping::check(mapping, manifest));
        }
        let suggested = manifest
            .map(|manifest| suggestions(&dir, &character, &manifest))
            .unwrap_or_default();
        Ok(CharacterMapping {
            model_url: url_base(&[id], &character.model),
            extras: character.extras,
            mapping,
            customized,
            warnings,
            suggested,
        })
    }

    /// Saves the user's edits to a character's mapping (D45) and reads it back. The file is
    /// written beside and then renamed, so a failed write keeps the previous edits.
    pub fn save_mapping(
        &self,
        id: &str,
        mapping: &Mapping,
    ) -> Result<CharacterMapping, CharacterError> {
        let dir = self
            .installed_dir(id)
            .ok_or_else(|| CharacterError::UnknownCharacter(id.to_owned()))?;
        let json = serde_json::to_vec_pretty(&mapping::to_json(mapping))
            .map_err(|e| CharacterError::InvalidPack(e.to_string()))?;
        let io = |e| CharacterError::io(USER_MAPPING_FILE, e);
        let partial = dir.join(format!("{USER_MAPPING_FILE}.partial"));
        fs::write(&partial, json).map_err(io)?;
        fs::rename(&partial, dir.join(USER_MAPPING_FILE)).map_err(io)?;
        self.mapping(id)
    }

    /// Drops the user's edits, so the pack's own mapping applies again, and reads it back.
    pub fn reset_mapping(&self, id: &str) -> Result<CharacterMapping, CharacterError> {
        let dir = self
            .installed_dir(id)
            .ok_or_else(|| CharacterError::UnknownCharacter(id.to_owned()))?;
        match fs::remove_file(dir.join(USER_MAPPING_FILE)) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => {
                return Err(CharacterError::io(USER_MAPPING_FILE, error));
            }
            _ => {}
        }
        self.mapping(id)
    }

    /// Builds and validates a pack from `source` in a new staging folder.
    pub fn stage(&self, source: &Source) -> Result<StagedImport, CharacterError> {
        let token = format!("{:x}", self.next_token.fetch_add(1, Ordering::Relaxed));
        let dir = self.staging(&token);
        let result = import::stage(source, &dir, &|id| self.is_installed(id))
            .and_then(|origin| pack::validate(&dir).map(|valid| (origin, valid)));
        let (origin, valid) = match result {
            Ok(staged) => staged,
            Err(error) => {
                remove_quietly(&dir);
                return Err(error);
            }
        };
        let base = [STAGING, token.as_str()];
        let character = &valid.character;
        let staged = StagedImport {
            token: token.clone(),
            character: summary(&dir, &base, character, &character.id, None),
            model_url: url_base(&base, &character.model),
            extras: character.extras.clone(),
            warnings: valid.warnings.clone(),
        };
        self.staged().insert(
            token,
            Staged {
                character: valid.character,
                origin,
                mapping: valid.mapping,
                warnings: valid.warnings,
                reviewed: false,
            },
        );
        Ok(staged)
    }

    /// Checks the mapping against the manifest the webview built and caches the manifest in
    /// the pack. A wrapped model gets the suggested slots and roles as its `mapping.json`, so
    /// Reset goes back to them; suggested base expressions wait for the user (D45).
    pub fn review(
        &self,
        token: &str,
        manifest: &ModelManifest,
        preferences: &Preferences,
    ) -> Result<ImportReview, CharacterError> {
        let json = serde_json::to_vec_pretty(manifest)
            .map_err(|e| CharacterError::InvalidPack(e.to_string()))?;
        fs::write(self.staging(token).join(MANIFEST_FILE), json)
            .map_err(|e| CharacterError::io(MANIFEST_FILE, e))?;

        let mut staged = self.staged();
        let entry = staged.get_mut(token).ok_or(CharacterError::UnknownImport)?;
        if entry.origin == Origin::Wrapped && entry.mapping.is_none() {
            let dir = self.staging(token);
            let prefilled = Mapping {
                base_expressions: Vec::new(),
                ..suggestions(&dir, &entry.character, manifest)
            };
            if prefilled != Mapping::default() {
                let json = serde_json::to_vec_pretty(&mapping::to_json(&prefilled))
                    .map_err(|e| CharacterError::InvalidPack(e.to_string()))?;
                fs::write(dir.join(MAPPING_FILE), json)
                    .map_err(|e| CharacterError::io(MAPPING_FILE, e))?;
                entry.mapping = Some(prefilled);
            }
        }
        let mut warnings = entry.warnings.clone();
        let installed = self.read_installed(&entry.character.id);
        // Replacing keeps the user's edits (see `commit`), so those are what get checked.
        let kept = installed
            .as_ref()
            .map(|(dir, _)| effective_mapping(dir))
            .filter(|effective| effective.customized);
        let checked = match &kept {
            Some(kept) => kept.mapping.as_ref(),
            None => entry.mapping.as_ref(),
        };
        if let Some(mapping) = checked {
            warnings.extend(mapping::check(mapping, manifest));
        }
        let needs_mapping = mapping::needs_attention(checked, manifest);
        entry.reviewed = true;
        let replaced =
            installed.map(|(_, character)| (character, preferences.get(&entry.character.id)));
        let alias = replaced
            .as_ref()
            .and_then(|(_, preferences)| preferences.and_then(|p| p.display_name.clone()));
        Ok(ImportReview {
            warnings,
            replaces: replaced
                .map(|(character, preferences)| display_name(&character, preferences)),
            name: alias.unwrap_or_else(|| entry.character.name.clone()),
            needs_mapping,
        })
    }

    /// Moves a reviewed import into place. An installed pack with the same id is replaced
    /// only when `replace` is set. Returns the new pack's `character.json`.
    pub fn commit(&self, token: &str, replace: bool) -> Result<CharacterJson, CharacterError> {
        let staged = self
            .staged()
            .remove(token)
            .ok_or(CharacterError::UnknownImport)?;
        let dir = self.staging(token);
        if !staged.reviewed {
            remove_quietly(&dir);
            return Err(CharacterError::UnknownImport);
        }
        let character = staged.character;
        let target = self.root.join(&character.id);
        let io = |e| CharacterError::io("the characters folder", e);
        if target.exists() {
            if !replace {
                remove_quietly(&dir);
                return Err(CharacterError::Conflict(character.id));
            }
            // The user's mapping edits outlive a re-import (D45), over any the pack brings.
            let edits = target.join(USER_MAPPING_FILE);
            if edits.is_file() {
                if let Err(error) = fs::copy(&edits, dir.join(USER_MAPPING_FILE)) {
                    remove_quietly(&dir);
                    return Err(CharacterError::io(USER_MAPPING_FILE, error));
                }
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
        Ok(character)
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
            .review(&staged.token, &manifest(), &Preferences::new())
            .expect("reviewed");
        assert_eq!(review.replaces, None);
        assert_eq!(
            library.commit(&staged.token, false).expect("committed").id,
            "hiyori"
        );
        assert!(tmp.path("characters/hiyori/manifest.json").is_file());

        let list = library.list(&Preferences::new());
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
            .review(&staged.token, &manifest(), &Preferences::new())
            .expect("reviewed");
        library.commit(&staged.token, false).expect("committed");

        character("Second");
        let staged = library
            .stage(&Source::Folder(source.clone()))
            .expect("staged");
        let review = library
            .review(&staged.token, &manifest(), &Preferences::new())
            .expect("reviewed");
        assert_eq!(review.replaces.as_deref(), Some("First"));
        assert!(matches!(
            library.commit(&staged.token, false),
            Err(CharacterError::Conflict(_))
        ));

        // The import offers the installed character's alias, so replacing keeps it.
        let aliased = Preferences::from([(
            "mine".to_owned(),
            CharacterSettings {
                display_name: Some("Mine".into()),
                ..CharacterSettings::default()
            },
        )]);
        let staged = library.stage(&Source::Folder(source)).expect("staged");
        let review = library
            .review(&staged.token, &manifest(), &aliased)
            .expect("reviewed");
        assert_eq!(review.replaces.as_deref(), Some("Mine"));
        assert_eq!(review.name, "Mine");
        library.commit(&staged.token, true).expect("replaced");
        assert_eq!(library.list(&Preferences::new())[0].name, "Second");
    }

    #[test]
    fn the_list_uses_aliases_and_sorts_by_them() {
        let tmp = TestDir::new("library-aliases");
        let library = CharacterLibrary::open(tmp.path("characters"));
        for stem in ["alpha", "beta"] {
            let model3 = model_folder(&tmp.path(&format!("source-{stem}")), stem);
            let staged = library.stage(&Source::File(model3)).expect("staged");
            let review = library
                .review(&staged.token, &manifest(), &Preferences::new())
                .expect("reviewed");
            assert_eq!(review.name, stem);
            library.commit(&staged.token, false).expect("committed");
        }
        let preferences = Preferences::from([(
            "beta".to_owned(),
            CharacterSettings {
                display_name: Some("Aardvark".into()),
                favorite: true,
                ..CharacterSettings::default()
            },
        )]);

        let list = library.list(&preferences);
        let names: Vec<_> = list
            .iter()
            .map(|c| (c.name.as_str(), c.pack_name.as_str(), c.favorite))
            .collect();
        assert_eq!(
            names,
            [("Aardvark", "beta", true), ("alpha", "alpha", false)]
        );
        assert_eq!(library.pack_name("beta").expect("installed"), "beta");
        assert!(matches!(
            library.pack_name("gamma"),
            Err(CharacterError::UnknownCharacter(_))
        ));
    }

    #[test]
    fn mapping_reads_the_pack_and_checks_it_against_the_manifest() {
        let tmp = TestDir::new("library-mapping");
        let library = CharacterLibrary::open(tmp.path("characters"));
        let source = tmp.path("pack");
        model_folder(&source.join("model"), "m");
        let character =
            json!({ "schema": 1, "id": "mine", "name": "Mine", "model": "model/m.model3.json" });
        fs::write(source.join("character.json"), character.to_string())
            .expect("write character.json");
        let mapping = json!({
            "schema": 1,
            "slots": { "joy": { "expression": "exp_01" }, "dance": { "motion": "Dance" } }
        });
        fs::write(source.join("mapping.json"), mapping.to_string()).expect("write mapping.json");
        let staged = library.stage(&Source::Folder(source)).expect("staged");
        library
            .review(&staged.token, &manifest(), &Preferences::new())
            .expect("reviewed");
        library.commit(&staged.token, false).expect("committed");

        let read = library.mapping("mine").expect("installed");
        assert!(read.model_url.ends_with("/mine/model/m.model3.json"));
        let mapping = read.mapping.expect("has a mapping");
        assert_eq!(mapping.slots.len(), 1);
        // The unknown slot, and the expression the empty manifest lacks.
        assert_eq!(read.warnings.len(), 2, "{:?}", read.warnings);

        fs::remove_file(tmp.path("characters/mine/mapping.json")).expect("remove mapping");
        let read = library.mapping("mine").expect("installed");
        assert!(read.mapping.is_none());
        assert!(read.warnings.is_empty());
        assert!(matches!(
            library.mapping("other"),
            Err(CharacterError::UnknownCharacter(_))
        ));
    }

    /// Installs a pack with id `mine` whose `mapping.json` maps `joy`, and returns its source
    /// folder for re-imports.
    fn install_mapped_pack(tmp: &TestDir, library: &CharacterLibrary) -> PathBuf {
        let source = tmp.path("pack");
        model_folder(&source.join("model"), "m");
        let character =
            json!({ "schema": 1, "id": "mine", "name": "Mine", "model": "model/m.model3.json" });
        fs::write(source.join("character.json"), character.to_string())
            .expect("write character.json");
        let mapping = json!({ "schema": 1, "slots": { "joy": { "expression": "exp_01" } } });
        fs::write(source.join("mapping.json"), mapping.to_string()).expect("write mapping.json");
        let staged = library
            .stage(&Source::Folder(source.clone()))
            .expect("staged");
        library
            .review(&staged.token, &manifest(), &Preferences::new())
            .expect("reviewed");
        library.commit(&staged.token, false).expect("committed");
        source
    }

    fn edited() -> Mapping {
        let (mapping, _) = mapping::parse(&json!({
            "schema": 1,
            "slots": { "idle": { "motion": "" }, "sad": { "expression": "exp_02" } }
        }));
        mapping
    }

    #[test]
    fn saved_edits_override_the_pack_mapping_until_reset() {
        let tmp = TestDir::new("library-save-mapping");
        let library = CharacterLibrary::open(tmp.path("characters"));
        install_mapped_pack(&tmp, &library);
        assert!(!library.mapping("mine").expect("installed").customized);

        let saved = library.save_mapping("mine", &edited()).expect("saved");
        assert!(saved.customized);
        assert_eq!(saved.mapping.as_ref(), Some(&edited()));
        // The test manifest has neither the unnamed motion group nor exp_02.
        assert_eq!(saved.warnings.len(), 2, "{:?}", saved.warnings);
        assert!(tmp.path("characters/mine/mapping.user.json").is_file());
        assert!(!tmp
            .path("characters/mine/mapping.user.json.partial")
            .exists());
        assert_eq!(
            library.active("mine").expect("installed").mapping,
            Some(edited())
        );

        let reset = library.reset_mapping("mine").expect("reset");
        assert!(!reset.customized);
        assert!(reset.mapping.expect("the pack's").slots.contains_key("joy"));
        // Resetting twice is fine.
        library.reset_mapping("mine").expect("reset again");
        assert!(matches!(
            library.save_mapping("other", &edited()),
            Err(CharacterError::UnknownCharacter(_))
        ));
    }

    #[test]
    fn unreadable_edits_fall_back_to_the_pack_mapping() {
        let tmp = TestDir::new("library-bad-edits");
        let library = CharacterLibrary::open(tmp.path("characters"));
        install_mapped_pack(&tmp, &library);
        fs::write(tmp.path("characters/mine/mapping.user.json"), "{ nope").expect("write");
        let read = library.mapping("mine").expect("installed");
        assert!(read.customized);
        assert!(read.mapping.expect("the pack's").slots.contains_key("joy"));
        assert!(read
            .warnings
            .iter()
            .any(|w| w.contains("mapping.user.json")));
    }

    #[test]
    fn replacing_a_pack_keeps_the_users_edits() {
        let tmp = TestDir::new("library-replace-edits");
        let library = CharacterLibrary::open(tmp.path("characters"));
        let source = install_mapped_pack(&tmp, &library);
        library.save_mapping("mine", &edited()).expect("saved");

        let staged = library.stage(&Source::Folder(source)).expect("staged");
        let review = library
            .review(&staged.token, &manifest(), &Preferences::new())
            .expect("reviewed");
        // The kept edits are checked, not the pack's mapping: exp_02, not exp_01.
        assert!(
            review.warnings.iter().any(|w| w.contains("exp_02")),
            "{:?}",
            review.warnings
        );
        assert!(!review.warnings.iter().any(|w| w.contains("exp_01")));
        library.commit(&staged.token, true).expect("replaced");
        let read = library.mapping("mine").expect("installed");
        assert!(read.customized);
        assert_eq!(read.mapping, Some(edited()));
    }

    /// A VTube Studio export: an angry toggle, a watermark toggle, head roles on `Param72`.
    fn vts_folder(dir: &Path) -> PathBuf {
        let model3 = model_folder(dir, "m");
        for name in ["生气脸", "水印开关"] {
            fs::write(dir.join(format!("{name}.exp3.json")), "{}").expect("write expression");
        }
        let vtube = json!({ "ParameterSettings": [
            { "Name": "Face Left/Right Rotation", "Input": "FaceAngleX", "OutputLive2D": "Param72" }
        ] });
        fs::write(dir.join("m.vtube.json"), vtube.to_string()).expect("write vtube.json");
        model3
    }

    fn vts_manifest() -> ModelManifest {
        ModelManifest {
            parameters: vec![crate::character::manifest::ParameterInfo {
                id: "Param72".into(),
                min: -30.0,
                max: 30.0,
                default: 0.0,
                name: None,
            }],
            expressions: vec!["生气脸".into(), "水印开关".into()],
            ..manifest()
        }
    }

    #[test]
    fn a_wrapped_model_is_installed_with_the_suggested_mapping() {
        let tmp = TestDir::new("library-prefill");
        let library = CharacterLibrary::open(tmp.path("characters"));
        let model3 = vts_folder(&tmp.path("source"));
        let staged = library.stage(&Source::File(model3)).expect("staged");
        let review = library
            .review(&staged.token, &vts_manifest(), &Preferences::new())
            .expect("reviewed");
        assert!(review.warnings.is_empty(), "{:?}", review.warnings);
        // Only "angry" is mapped, so the editor should open.
        assert!(review.needs_mapping);
        library.commit(&staged.token, false).expect("committed");

        let read = library.mapping("m").expect("installed");
        assert!(!read.customized);
        let mapping = read.mapping.expect("prefilled");
        assert_eq!(
            mapping.slots,
            BTreeMap::from([(
                "angry".to_owned(),
                mapping::Target::Expression("生气脸".into())
            )])
        );
        assert_eq!(mapping.parameters["ParamAngleX"], "Param72");
        // The watermark toggle is only suggested, never worn without the user's say.
        assert!(mapping.base_expressions.is_empty());
        assert_eq!(read.suggested.base_expressions, ["水印开关"]);
        assert_eq!(read.suggested.slots, mapping.slots);
    }

    #[test]
    fn a_pack_without_a_mapping_keeps_its_files() {
        let tmp = TestDir::new("library-prefill-pack");
        let library = CharacterLibrary::open(tmp.path("characters"));
        let source = tmp.path("pack");
        vts_folder(&source.join("model"));
        let character =
            json!({ "schema": 1, "id": "mine", "name": "Mine", "model": "model/m.model3.json" });
        fs::write(source.join("character.json"), character.to_string())
            .expect("write character.json");
        let staged = library.stage(&Source::Folder(source)).expect("staged");
        library
            .review(&staged.token, &vts_manifest(), &Preferences::new())
            .expect("reviewed");
        library.commit(&staged.token, false).expect("committed");

        assert!(!tmp.path("characters/mine/mapping.json").exists());
        let read = library.mapping("mine").expect("installed");
        assert!(read.mapping.is_none());
        assert!(read.suggested.slots.contains_key("angry"));
    }

    #[test]
    fn remove_deletes_the_pack() {
        let tmp = TestDir::new("library-remove");
        let library = CharacterLibrary::open(tmp.path("characters"));
        let staged = library
            .stage(&Source::File(model_folder(&tmp.path("source"), "m")))
            .expect("staged");
        library
            .review(&staged.token, &manifest(), &Preferences::new())
            .expect("reviewed");
        library.commit(&staged.token, false).expect("committed");

        library.remove("m").expect("removed");
        assert!(library.list(&Preferences::new()).is_empty());
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
