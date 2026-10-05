//! Builds a pack in a staging folder from what the user picked (D42): a pack folder is
//! copied whole, a zip is extracted first, and a bare model folder or `model3.json` is
//! wrapped in a new pack with only the files the model uses.

use std::{
    collections::{HashSet, VecDeque},
    fs::{self, File},
    io::{self, BufReader, Read},
    path::{Path, PathBuf},
};

use serde_json::Value;
use zip::ZipArchive;

use super::{
    model3::{self, ModelFiles},
    names,
    pack::{
        read_json, CharacterJson, ExtraExpression, ExtraMotion, ExtraMotionGroup, ModelExtras,
        CHARACTER_FILE, ICON_FILE, MODEL_SUFFIX, PERSONA_FILE,
    },
    paths::{is_plain_segment, safe_relative_path, slugify, unique_id},
    CharacterError,
};

/// Generous for 8K-texture models; anything bigger is more likely a wrong pick.
const MAX_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_FILES: usize = 10_000;
/// How deep and how wide a folder is searched for a `model3.json`.
const SEARCH_DEPTH: usize = 3;
const MAX_SEARCH_ENTRIES: usize = 20_000;
/// Wrapped models keep their files here, inside the pack.
const MODEL_FOLDER: &str = "model";
/// macOS adds this to zips; it holds resource forks, never model files.
const MACOS_METADATA: &str = "__MACOSX";

const EXPRESSION_SUFFIX: &str = ".exp3.json";
const MOTION_SUFFIX: &str = ".motion3.json";
const VTUBE_SUFFIX: &str = ".vtube.json";

pub enum Source {
    Folder(PathBuf),
    /// A zip or a `model3.json`.
    File(PathBuf),
}

/// Caps what one import may write, so a wrong folder or a zip bomb fails early.
#[derive(Default)]
struct Budget {
    bytes: u64,
    files: usize,
}

impl Budget {
    fn take(&mut self, bytes: u64) -> Result<(), CharacterError> {
        self.files += 1;
        self.bytes = self.bytes.saturating_add(bytes);
        if self.files > MAX_FILES || self.bytes > MAX_BYTES {
            return Err(CharacterError::TooLarge);
        }
        Ok(())
    }
}

fn ends_with_ignore_case(name: &str, suffix: &str) -> bool {
    name.len() >= suffix.len()
        && name.is_char_boundary(name.len() - suffix.len())
        && name[name.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

fn strip_suffix_ignore_case<'a>(name: &'a str, suffix: &str) -> Option<&'a str> {
    ends_with_ignore_case(name, suffix).then(|| &name[..name.len() - suffix.len()])
}

fn file_name(path: &Path) -> Option<&str> {
    path.file_name().and_then(|name| name.to_str())
}

/// Fills `dest`, which must not exist yet, with a pack built from `source`. `taken` tells
/// which ids are installed, so a wrapped model gets a fresh one.
pub fn stage(
    source: &Source,
    dest: &Path,
    taken: &dyn Fn(&str) -> bool,
) -> Result<(), CharacterError> {
    match source {
        Source::Folder(dir) => stage_folder(dir, dest, taken),
        Source::File(file) => {
            let name = file_name(file).unwrap_or_default();
            if ends_with_ignore_case(name, ".zip") {
                let mut extracted = dest.as_os_str().to_owned();
                extracted.push("-zip");
                let extracted = PathBuf::from(extracted);
                let result = extract_zip(file, &extracted)
                    .and_then(|()| stage_folder(&extracted, dest, taken));
                if let Err(error) = fs::remove_dir_all(&extracted) {
                    tracing::warn!(%error, "could not remove an extracted zip");
                }
                result
            } else if ends_with_ignore_case(name, MODEL_SUFFIX) {
                wrap(file, dest, taken)
            } else {
                Err(CharacterError::Unsupported)
            }
        }
    }
}

fn stage_folder(
    dir: &Path,
    dest: &Path,
    taken: &dyn Fn(&str) -> bool,
) -> Result<(), CharacterError> {
    match locate(dir)? {
        Located::Pack(pack) => copy_tree(&pack, dest, &mut Budget::default()),
        Located::Model(model) => wrap(&model, dest, taken),
    }
}

#[derive(Debug, PartialEq)]
enum Located {
    Pack(PathBuf),
    Model(PathBuf),
}

/// Plain entries of `dir`, skipping links, hidden files and macOS metadata.
fn entries(dir: &Path) -> Result<Vec<(String, PathBuf, bool)>, CharacterError> {
    let read = fs::read_dir(dir).map_err(|e| CharacterError::io("the folder", e))?;
    let mut entries = Vec::new();
    for entry in read {
        let entry = entry.map_err(|e| CharacterError::io("the folder", e))?;
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if kind.is_symlink() || name.starts_with('.') || name == MACOS_METADATA {
            continue;
        }
        if kind.is_dir() || kind.is_file() {
            entries.push((name, entry.path(), kind.is_dir()));
        }
    }
    entries.sort();
    Ok(entries)
}

/// Finds the pack or model in a picked or extracted folder.
fn locate(dir: &Path) -> Result<Located, CharacterError> {
    let mut dir = dir.to_path_buf();
    loop {
        if dir.join(CHARACTER_FILE).is_file() {
            return Ok(Located::Pack(dir));
        }
        // Zips usually wrap everything in one folder.
        match entries(&dir)?.as_slice() {
            [(_, sub, true)] => dir = sub.clone(),
            _ => break,
        }
    }

    let mut models = Vec::new();
    let mut queue = VecDeque::from([(dir, 0)]);
    let mut seen = 0;
    while let Some((dir, depth)) = queue.pop_front() {
        for (name, path, is_dir) in entries(&dir)? {
            seen += 1;
            if seen > MAX_SEARCH_ENTRIES {
                return Err(CharacterError::NotFound(
                    "the folder is too large to search; pick the model's own folder".into(),
                ));
            }
            if is_dir && depth + 1 < SEARCH_DEPTH {
                queue.push_back((path, depth + 1));
            } else if !is_dir && ends_with_ignore_case(&name, MODEL_SUFFIX) {
                models.push(path);
            }
        }
    }
    match models.len() {
        0 => Err(CharacterError::NotFound(
            "no character.json or .model3.json found".into(),
        )),
        1 => Ok(Located::Model(models.remove(0))),
        n => Err(CharacterError::NotFound(format!(
            "found {n} models; import the .model3.json you want instead"
        ))),
    }
}

fn copy_file(from: &Path, to: &Path, budget: &mut Budget) -> Result<(), CharacterError> {
    let what = file_name(from).unwrap_or("a file");
    let meta = fs::metadata(from).map_err(|e| CharacterError::io(what, e))?;
    budget.take(meta.len())?;
    if let Some(dir) = to.parent() {
        fs::create_dir_all(dir).map_err(|e| CharacterError::io(what, e))?;
    }
    fs::copy(from, to).map_err(|e| CharacterError::io(what, e))?;
    Ok(())
}

/// Copies a pack folder, leaving out links and names Windows treats specially.
fn copy_tree(from: &Path, to: &Path, budget: &mut Budget) -> Result<(), CharacterError> {
    fs::create_dir_all(to).map_err(|e| CharacterError::io("the pack", e))?;
    for (name, path, is_dir) in entries(from)? {
        if !is_plain_segment(&name) {
            continue;
        }
        if is_dir {
            copy_tree(&path, &to.join(&name), budget)?;
        } else {
            copy_file(&path, &to.join(&name), budget)?;
        }
    }
    Ok(())
}

/// Copies `relative` from `dir` into `out`, unless it is missing or a link. Returns whether
/// it was copied.
fn copy_relative(
    dir: &Path,
    out: &Path,
    relative: &str,
    budget: &mut Budget,
) -> Result<bool, CharacterError> {
    let from = dir.join(relative);
    match fs::symlink_metadata(&from) {
        Ok(meta) if meta.is_file() => {
            copy_file(&from, &out.join(relative), budget)?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

/// What a VTube Studio `.vtube.json` next to the model adds.
#[derive(Debug, Default, PartialEq)]
struct VtubeInfo {
    /// The file itself, kept in the pack: its parameter mapping and toggle hotkeys are what
    /// the mapping editor can prefill from.
    file: Option<String>,
    idle: Option<String>,
    icon: Option<String>,
}

fn vtube_info(model_dir: &Path, names: &[String]) -> VtubeInfo {
    let Some(name) = names
        .iter()
        .find(|n| ends_with_ignore_case(n, VTUBE_SUFFIX))
    else {
        return VtubeInfo::default();
    };
    let Ok(json) = read_json(&model_dir.join(name)) else {
        return VtubeInfo::default();
    };
    let reference = |key: &str| {
        json.get("FileReferences")
            .and_then(|refs| refs.get(key))
            .and_then(Value::as_str)
            .and_then(safe_relative_path)
            .filter(|path| model_dir.join(path).is_file())
    };
    VtubeInfo {
        file: Some(name.clone()),
        idle: reference("IdleAnimation"),
        icon: reference("Icon").filter(|icon| ends_with_ignore_case(icon, ".png")),
    }
}

/// Expressions and motions that sit next to the model but are not in its `model3.json`.
/// Only looked for when the `model3.json` lists none of that kind, so a curated model is
/// left as its author made it; the VTube Studio idle clip is added unless an idle group
/// exists.
fn discover_extras(files: &ModelFiles, names: &[String], vtube_idle: Option<&str>) -> ModelExtras {
    let listed: HashSet<String> = files.optional.iter().map(|f| f.to_lowercase()).collect();
    let listed = &listed;
    let unlisted = |suffix: &'static str| {
        names.iter().filter_map(move |name| {
            let stem = strip_suffix_ignore_case(name, suffix)?;
            (!stem.is_empty() && !listed.contains(&name.to_lowercase())).then_some((stem, name))
        })
    };
    let mut extras = ModelExtras::default();
    if files.expression_names.is_empty() {
        extras.expressions = unlisted(EXPRESSION_SUFFIX)
            .map(|(stem, name)| ExtraExpression {
                name: stem.to_owned(),
                file: name.clone(),
            })
            .collect();
    }
    let has_idle = files
        .motion_groups
        .iter()
        .any(|g| g.eq_ignore_ascii_case("idle"));
    let idle = vtube_idle.filter(|_| !has_idle);
    if let Some(idle) = idle {
        extras.motion_groups.push(ExtraMotionGroup {
            name: "Idle".into(),
            motions: vec![ExtraMotion { file: idle.into() }],
        });
    }
    if files.motion_groups.is_empty() {
        // One group per clip, named after it, so each can be mapped on its own.
        for (stem, name) in unlisted(MOTION_SUFFIX) {
            if Some(name.as_str()) != idle && !extras.motion_groups.iter().any(|g| g.name == stem) {
                extras.motion_groups.push(ExtraMotionGroup {
                    name: stem.to_owned(),
                    motions: vec![ExtraMotion { file: name.clone() }],
                });
            }
        }
    }
    extras
}

fn default_persona(name: &str) -> String {
    format!(
        "# {name}\n\n\
         Describe {name}'s personality, way of speaking and backstory here. Itsumo Desk adds\n\
         the rules for replies, expressions and tools by itself.\n"
    )
}

/// Wraps a bare model in a new pack: `character.json`, a placeholder `persona.md`, the
/// icon if VTube Studio or the folder has one, and the model's files under `model/`.
fn wrap(model3: &Path, dest: &Path, taken: &dyn Fn(&str) -> bool) -> Result<(), CharacterError> {
    let file = file_name(model3)
        .ok_or_else(|| CharacterError::NotFound("the model has no usable file name".into()))?;
    let stem = strip_suffix_ignore_case(file, MODEL_SUFFIX)
        .filter(|stem| !stem.is_empty())
        .unwrap_or(file);
    let model_dir = model3
        .parent()
        .ok_or_else(|| CharacterError::NotFound("the model has no folder".into()))?;
    let files = model3::parse(&read_json(model3)?)?;
    let names: Vec<String> = entries(model_dir)?
        .into_iter()
        .filter(|(name, _, is_dir)| !is_dir && is_plain_segment(name))
        .map(|(name, _, _)| name)
        .collect();
    let vtube = vtube_info(model_dir, &names);
    let extras = discover_extras(&files, &names, vtube.idle.as_deref());

    let out = dest.join(MODEL_FOLDER);
    let mut budget = Budget::default();
    copy_file(model3, &out.join(file), &mut budget)?;
    for required in &files.required {
        if !copy_relative(model_dir, &out, required, &mut budget)? {
            return Err(CharacterError::InvalidModel(format!(
                "the model needs {required}, which is missing"
            )));
        }
    }
    // Missing optional files are reported by validation, which reads the copied model3.json.
    for optional in files
        .optional
        .iter()
        .chain(extras.files())
        .chain(vtube.file.as_ref())
    {
        copy_relative(model_dir, &out, optional, &mut budget)?;
    }
    let icon = vtube.icon.or_else(|| {
        names
            .iter()
            .find(|name| name.eq_ignore_ascii_case(ICON_FILE))
            .cloned()
    });
    if let Some(icon) = icon {
        copy_file(&model_dir.join(icon), &dest.join(ICON_FILE), &mut budget)?;
    }

    let name = names::from_stem(stem);
    let character = CharacterJson {
        id: unique_id(&slugify(stem), taken),
        name: name.clone(),
        author: String::new(),
        license: String::new(),
        model: format!("{MODEL_FOLDER}/{file}"),
        extras,
    };
    let json = serde_json::to_vec_pretty(&character.to_json())
        .map_err(|e| CharacterError::InvalidPack(e.to_string()))?;
    fs::write(dest.join(CHARACTER_FILE), json)
        .map_err(|e| CharacterError::io(CHARACTER_FILE, e))?;
    fs::write(dest.join(PERSONA_FILE), default_persona(&name))
        .map_err(|e| CharacterError::io(PERSONA_FILE, e))?;
    Ok(())
}

fn zip_error(error: zip::result::ZipError) -> CharacterError {
    CharacterError::Zip(error.to_string())
}

/// Extracts `zip` into `dest`, skipping links and entries that would land outside it, and
/// checking real sizes against the budget (headers can lie).
fn extract_zip(zip: &Path, dest: &Path) -> Result<(), CharacterError> {
    let file = File::open(zip).map_err(|e| CharacterError::io("the zip", e))?;
    let mut archive = ZipArchive::new(BufReader::new(file)).map_err(zip_error)?;
    let mut budget = Budget::default();
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        if entry.is_dir() || entry.is_symlink() {
            continue;
        }
        // Many tools write UTF-8 names without setting the flag that says so, and the
        // fallback (CP437) would garble CJK file names.
        let name = std::str::from_utf8(entry.name_raw())
            .map(str::to_owned)
            .unwrap_or_else(|_| entry.name().to_owned());
        let Some(relative) = safe_relative_path(&name) else {
            continue;
        };
        if relative.split('/').next() == Some(MACOS_METADATA) {
            continue;
        }
        let declared = entry.size();
        budget.take(declared)?;
        let path = dest.join(&relative);
        if let Some(dir) = path.parent() {
            fs::create_dir_all(dir).map_err(|e| CharacterError::io(&relative, e))?;
        }
        let mut out = File::create(&path).map_err(|e| CharacterError::io(&relative, e))?;
        let written = io::copy(&mut (&mut entry).take(declared + 1), &mut out)
            .map_err(|e| CharacterError::io(&relative, e))?;
        if written > declared {
            return Err(CharacterError::TooLarge);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::io::Write;

    use serde_json::json;

    use super::*;
    use crate::character::{pack, test_dir::TestDir};

    fn write(path: &Path, contents: &[u8]) {
        fs::create_dir_all(path.parent().expect("has a parent")).expect("create dirs");
        fs::write(path, contents).expect("write file");
    }

    fn write_json(path: &Path, value: Value) {
        write(path, value.to_string().as_bytes());
    }

    /// A VTube Studio style export: nothing but the moc and textures in `model3.json`.
    fn vts_model(dir: &Path, stem: &str) -> PathBuf {
        let model3 = dir.join(format!("{stem}.model3.json"));
        write_json(
            &model3,
            json!({
                "Version": 3,
                "FileReferences": {
                    "Moc": format!("{stem}.moc3"),
                    "Textures": [format!("{stem}.4096/texture_00.png")],
                    "Physics": format!("{stem}.physics3.json"),
                    "DisplayInfo": "missing.cdi3.json"
                }
            }),
        );
        write(&dir.join(format!("{stem}.moc3")), b"moc");
        write(&dir.join(format!("{stem}.4096/texture_00.png")), b"png");
        write(&dir.join(format!("{stem}.physics3.json")), b"{}");
        write(&dir.join("害羞脸.exp3.json"), b"{}");
        write(&dir.join("O形嘴.exp3.json"), b"{}");
        write(&dir.join("IDLE.motion3.json"), b"{}");
        write(&dir.join("招手.motion3.json"), b"{}");
        write(&dir.join("headshot.png"), b"icon");
        write(&dir.join("items_pinned_to_model.json"), b"{}");
        write_json(
            &dir.join(format!("{stem}.vtube.json")),
            json!({ "FileReferences": { "IdleAnimation": "IDLE.motion3.json", "Icon": "headshot.png" } }),
        );
        model3
    }

    #[test]
    fn wraps_a_vtube_studio_model_with_its_extras() {
        let tmp = TestDir::new("import-vts");
        let model3 = vts_model(&tmp.path("source"), "阿库露_vts");
        let dest = tmp.path("staged");
        stage(&Source::File(model3), &dest, &|id| id == "vts").expect("staged");

        let valid = pack::validate(&dest).expect("valid pack");
        let character = valid.character;
        assert_eq!(character.id, "vts-2");
        assert_eq!(character.name, "阿库露 vts");
        assert_eq!(character.model, "model/阿库露_vts.model3.json");
        let expressions: Vec<_> = character
            .extras
            .expressions
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(expressions, ["O形嘴", "害羞脸"]);
        let groups: Vec<_> = character
            .extras
            .motion_groups
            .iter()
            .map(|g| g.name.as_str())
            .collect();
        assert_eq!(groups, ["Idle", "招手"]);
        assert!(dest.join("icon.png").is_file());
        assert!(dest.join("persona.md").is_file());
        assert!(dest.join("model/阿库露_vts.4096/texture_00.png").is_file());
        assert!(dest.join("model/阿库露_vts.vtube.json").is_file());
        assert!(!dest.join("model/items_pinned_to_model.json").exists());
        assert!(!dest.join("model/headshot.png").exists());
        assert_eq!(
            valid.warnings,
            ["the model refers to missing.cdi3.json, which is missing"]
        );
    }

    #[test]
    fn a_curated_model_gets_no_extras() {
        let tmp = TestDir::new("import-curated");
        let source = tmp.path("source");
        write_json(
            &source.join("runtime/m.model3.json"),
            json!({
                "FileReferences": {
                    "Moc": "m.moc3",
                    "Textures": ["t.png"],
                    "Expressions": [{ "Name": "smile", "File": "exp/smile.exp3.json" }],
                    "Motions": { "Idle": [{ "File": "motion/idle.motion3.json" }] }
                }
            }),
        );
        write(&source.join("runtime/m.moc3"), b"moc");
        write(&source.join("runtime/t.png"), b"png");
        write(&source.join("runtime/exp/smile.exp3.json"), b"{}");
        write(&source.join("runtime/motion/idle.motion3.json"), b"{}");
        write(&source.join("runtime/unused.exp3.json"), b"{}");
        write(&source.join("m.cmo3"), b"editor file");

        let dest = tmp.path("staged");
        stage(&Source::Folder(source), &dest, &|_| false).expect("staged");
        let valid = pack::validate(&dest).expect("valid pack");
        assert_eq!(valid.character.id, "m");
        assert!(valid.character.extras.is_empty());
        assert!(valid.warnings.is_empty(), "{:?}", valid.warnings);
        assert!(dest.join("model/motion/idle.motion3.json").is_file());
        assert!(!dest.join("model/unused.exp3.json").exists());
    }

    #[test]
    fn a_pack_folder_is_copied_whole() {
        let tmp = TestDir::new("import-pack");
        let source = tmp.path("source/my-pack");
        write_json(
            &source.join("character.json"),
            json!({ "schema": 1, "id": "mine", "name": "Mine", "model": "model/m.model3.json" }),
        );
        write_json(
            &source.join("model/m.model3.json"),
            json!({ "FileReferences": { "Moc": "m.moc3", "Textures": ["t.png"] } }),
        );
        write(&source.join("model/m.moc3"), b"moc");
        write(&source.join("model/t.png"), b"png");
        write(&source.join("persona.md"), b"# Mine");
        write(&source.join("notes/readme.txt"), b"kept");

        let dest = tmp.path("staged");
        // A folder that only holds the pack folder is descended into.
        stage(&Source::Folder(tmp.path("source")), &dest, &|_| true).expect("staged");
        assert_eq!(pack::validate(&dest).expect("valid").character.id, "mine");
        assert!(dest.join("notes/readme.txt").is_file());
    }

    #[test]
    fn folders_without_exactly_one_model_are_rejected() {
        let tmp = TestDir::new("import-ambiguous");
        let empty = tmp.path("empty");
        write(&empty.join("readme.txt"), b"");
        assert!(matches!(
            stage(&Source::Folder(empty), &tmp.path("a"), &|_| false),
            Err(CharacterError::NotFound(_))
        ));
        let two = tmp.path("two");
        write(&two.join("a/a.model3.json"), b"{}");
        write(&two.join("b/b.model3.json"), b"{}");
        assert!(matches!(
            stage(&Source::Folder(two), &tmp.path("b"), &|_| false),
            Err(CharacterError::NotFound(_))
        ));
    }

    #[test]
    fn a_model_missing_its_moc_is_rejected() {
        let tmp = TestDir::new("import-no-moc");
        let source = tmp.path("source");
        write_json(
            &source.join("m.model3.json"),
            json!({ "FileReferences": { "Moc": "m.moc3", "Textures": ["t.png"] } }),
        );
        write(&source.join("t.png"), b"png");
        assert!(matches!(
            stage(&Source::Folder(source), &tmp.path("staged"), &|_| false),
            Err(CharacterError::InvalidModel(_))
        ));
    }

    fn write_zip(path: &Path, entries: &[(&str, &[u8])]) {
        let file = File::create(path).expect("create zip");
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, contents) in entries {
            zip.start_file(*name, options).expect("start entry");
            zip.write_all(contents).expect("write entry");
        }
        zip.finish().expect("finish zip");
    }

    #[test]
    fn zips_are_extracted_and_escaping_entries_skipped() {
        let tmp = TestDir::new("import-zip");
        fs::create_dir_all(tmp.path("")).expect("create dir");
        let zip = tmp.path("model.zip");
        let model3 =
            json!({ "FileReferences": { "Moc": "m.moc3", "Textures": ["t.png"] } }).to_string();
        write_zip(
            &zip,
            &[
                ("model/m.model3.json", model3.as_bytes()),
                ("model/m.moc3", b"moc"),
                ("model/t.png", b"png"),
                ("../escape.txt", b"nope"),
                ("__MACOSX/model/._t.png", b"fork"),
            ],
        );
        let dest = tmp.path("staging/1");
        stage(&Source::File(zip), &dest, &|_| false).expect("staged");
        assert_eq!(pack::validate(&dest).expect("valid").character.id, "m");
        assert!(!tmp.path("staging/escape.txt").exists());
        assert!(!tmp.path("escape.txt").exists());
        // The extraction folder is cleaned up.
        assert!(!tmp.path("staging/1-zip").exists());
    }

    #[test]
    fn other_files_are_unsupported() {
        let tmp = TestDir::new("import-other");
        assert!(matches!(
            stage(
                &Source::File(tmp.path("a.rar")),
                &tmp.path("staged"),
                &|_| false
            ),
            Err(CharacterError::Unsupported)
        ));
    }
}
