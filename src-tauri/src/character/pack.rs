//! A character pack on disk (`06-character-packs.md`): `character.json`, the model folder,
//! and the optional `mapping.json`, `persona.md` and `icon.png`.

use std::{fs, path::Path};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

use super::{
    mapping::{self, Mapping},
    model3,
    paths::{is_valid_id, safe_relative_path},
    CharacterError,
};

pub const CHARACTER_FILE: &str = "character.json";
pub const MAPPING_FILE: &str = "mapping.json";
pub const PERSONA_FILE: &str = "persona.md";
pub const ICON_FILE: &str = "icon.png";
pub const MANIFEST_FILE: &str = "manifest.json";
pub const MODEL_SUFFIX: &str = ".model3.json";

const SCHEMA: u64 = 1;

/// Expressions and motions that ship with a model but are missing from its `model3.json`,
/// typical of VTube Studio exports. The loader merges them into the parsed `model3.json`,
/// so the Live2D export itself stays untouched. Paths are relative to the `model3.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelExtras {
    pub expressions: Vec<ExtraExpression>,
    pub motion_groups: Vec<ExtraMotionGroup>,
}

impl ModelExtras {
    pub fn is_empty(&self) -> bool {
        self.expressions.is_empty() && self.motion_groups.is_empty()
    }

    pub fn files(&self) -> impl Iterator<Item = &String> {
        let expressions = self.expressions.iter().map(|e| &e.file);
        let motions = self
            .motion_groups
            .iter()
            .flat_map(|g| g.motions.iter().map(|m| &m.file));
        expressions.chain(motions)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ExtraExpression {
    pub name: String,
    pub file: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ExtraMotionGroup {
    pub name: String,
    pub motions: Vec<ExtraMotion>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ExtraMotion {
    pub file: String,
}

/// The parts of `character.json` the app reads so far. Voice, traits and likes arrive with
/// the features that use them; the file is never rewritten, so they are kept on disk.
#[derive(Debug, Clone, PartialEq)]
pub struct CharacterJson {
    pub id: String,
    pub name: String,
    pub author: String,
    pub license: String,
    /// The `model3.json`, relative to the pack.
    pub model: String,
    pub extras: ModelExtras,
}

impl CharacterJson {
    /// The folder holding the `model3.json`, relative to the pack, with a trailing `/` (or
    /// empty when it sits at the pack's root).
    pub fn model_dir(&self) -> &str {
        self.model
            .rsplit_once('/')
            .map_or("", |(dir, _)| &self.model[..dir.len() + 1])
    }

    pub fn to_json(&self) -> Value {
        let mut value = json!({
            "schema": SCHEMA,
            "id": self.id,
            "name": self.name,
            "author": self.author,
            "license": self.license,
            "model": self.model,
        });
        if !self.extras.is_empty() {
            value["modelExtras"] = json!(self.extras);
        }
        value
    }
}

fn text(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

fn parse_extras(value: Option<&Value>, warnings: &mut Vec<String>) -> ModelExtras {
    let mut extras = ModelExtras::default();
    let Some(value) = value else {
        return extras;
    };
    let mut path = |raw: Option<&str>| {
        let path = raw.and_then(safe_relative_path);
        if path.is_none() {
            warnings.push(format!(
                "modelExtras skips an invalid file reference: {}",
                raw.unwrap_or("(none)")
            ));
        }
        path
    };
    for entry in value
        .get("expressions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = text(entry.get("name"));
        if let (Some(name), Some(file)) = (name, path(text(entry.get("file")))) {
            extras.expressions.push(ExtraExpression {
                name: name.to_owned(),
                file,
            });
        }
    }
    for group in value
        .get("motionGroups")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(name) = group.get("name").and_then(Value::as_str) else {
            continue;
        };
        let motions: Vec<_> = group
            .get("motions")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|m| path(text(m.get("file"))))
            .map(|file| ExtraMotion { file })
            .collect();
        if !motions.is_empty() {
            extras.motion_groups.push(ExtraMotionGroup {
                name: name.to_owned(),
                motions,
            });
        }
    }
    extras
}

/// Parses `character.json`. An unusable id, model reference or a newer schema is an error;
/// anything else falls back with a warning.
pub fn parse_character(json: &Value) -> Result<(CharacterJson, Vec<String>), CharacterError> {
    let invalid = |reason: String| CharacterError::InvalidPack(reason);
    let root = json
        .as_object()
        .ok_or_else(|| invalid("character.json is not an object".into()))?;
    let mut warnings = Vec::new();
    match root.get("schema").and_then(Value::as_u64) {
        Some(SCHEMA) => {}
        Some(schema) if schema > SCHEMA => {
            return Err(invalid(format!(
                "the pack uses schema {schema}; update Itsumo Desk to import it"
            )))
        }
        _ => warnings.push("character.json has no valid schema; read as schema 1".into()),
    }
    let id = text(root.get("id"))
        .filter(|id| is_valid_id(id))
        .ok_or_else(|| {
            invalid("character.json needs an id of lower-case letters, digits, - and _".into())
        })?
        .to_owned();
    let model = text(root.get("model"))
        .and_then(safe_relative_path)
        .filter(|model| model.to_lowercase().ends_with(MODEL_SUFFIX))
        .ok_or_else(|| invalid("character.json has no valid model3.json reference".into()))?;
    let name = match text(root.get("name")) {
        Some(name) => name.to_owned(),
        None => {
            warnings.push("character.json has no name; using its id".into());
            id.clone()
        }
    };
    let extras = parse_extras(root.get("modelExtras"), &mut warnings);
    Ok((
        CharacterJson {
            id,
            name,
            author: text(root.get("author")).unwrap_or_default().to_owned(),
            license: text(root.get("license")).unwrap_or_default().to_owned(),
            model,
            extras,
        },
        warnings,
    ))
}

pub fn read_json(path: &Path) -> Result<Value, CharacterError> {
    let name = || {
        path.file_name()
            .map_or_else(String::new, |n| n.to_string_lossy().into_owned())
    };
    let bytes = fs::read(path).map_err(|error| CharacterError::io(&name(), error))?;
    // Some editors write a BOM, which serde_json rejects.
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    serde_json::from_slice(bytes).map_err(|error| {
        CharacterError::InvalidPack(format!("{} is not valid JSON: {error}", name()))
    })
}

pub fn read_character(pack: &Path) -> Result<(CharacterJson, Vec<String>), CharacterError> {
    parse_character(&read_json(&pack.join(CHARACTER_FILE))?)
}

/// A pack that passed validation.
#[derive(Debug)]
pub struct ValidPack {
    pub character: CharacterJson,
    pub mapping: Option<Mapping>,
    pub warnings: Vec<String>,
}

/// Checks a pack folder: `character.json`, that the model's required files exist inside it,
/// and `mapping.json` if present. Missing optional files and bad extras are warnings and
/// are left for the loader to skip.
pub fn validate(pack: &Path) -> Result<ValidPack, CharacterError> {
    let (mut character, mut warnings) = read_character(pack)?;
    let model_path = pack.join(&character.model);
    if !model_path.is_file() {
        return Err(CharacterError::InvalidPack(format!(
            "the pack has no {}",
            character.model
        )));
    }
    let files = model3::parse(&read_json(&model_path)?)?;
    let model_dir = pack.join(character.model_dir());
    for file in &files.required {
        if !model_dir.join(file).is_file() {
            return Err(CharacterError::InvalidModel(format!(
                "the model needs {file}, which is missing"
            )));
        }
    }
    for file in &files.optional {
        if !model_dir.join(file).is_file() {
            warnings.push(format!("the model refers to {file}, which is missing"));
        }
    }
    for file in &files.rejected {
        warnings.push(format!(
            "the model refers to {file} outside its folder; skipped"
        ));
    }
    let before = character.extras.files().count();
    character
        .extras
        .expressions
        .retain(|e| model_dir.join(&e.file).is_file());
    for group in &mut character.extras.motion_groups {
        group.motions.retain(|m| model_dir.join(&m.file).is_file());
    }
    character
        .extras
        .motion_groups
        .retain(|g| !g.motions.is_empty());
    let dropped = before - character.extras.files().count();
    if dropped > 0 {
        warnings.push(format!(
            "{dropped} modelExtras file(s) are missing; skipped"
        ));
    }

    let mapping_path = pack.join(MAPPING_FILE);
    let mapping = if mapping_path.is_file() {
        let (mapping, mapping_warnings) = mapping::parse(&read_json(&mapping_path)?);
        warnings.extend(mapping_warnings);
        Some(mapping)
    } else {
        None
    };
    Ok(ValidPack {
        character,
        mapping,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_full_character_json() {
        let (character, warnings) = parse_character(&json!({
            "schema": 1,
            "id": "my-character",
            "name": "Display Name",
            "author": "Someone",
            "license": "CC BY 4.0",
            "model": "model\\xxx.model3.json",
            "voice": { "provider": "voicevox", "speaker": 3 },
            "modelExtras": {
                "expressions": [
                    { "name": "smile", "file": "smile.exp3.json" },
                    { "name": "bad", "file": "../x.exp3.json" }
                ],
                "motionGroups": [
                    { "name": "Idle", "motions": [{ "file": "IDLE.motion3.json" }] },
                    { "name": "Empty", "motions": [] }
                ]
            }
        }))
        .expect("valid character.json");
        assert_eq!(character.id, "my-character");
        assert_eq!(character.model, "model/xxx.model3.json");
        assert_eq!(character.model_dir(), "model/");
        assert_eq!(character.extras.expressions.len(), 1);
        assert_eq!(character.extras.motion_groups.len(), 1);
        assert_eq!(warnings.len(), 1, "{warnings:?}");
    }

    #[test]
    fn missing_name_and_schema_fall_back() {
        let (character, warnings) =
            parse_character(&json!({ "id": "a", "model": "a.model3.json" })).expect("valid enough");
        assert_eq!(character.name, "a");
        assert_eq!(character.model_dir(), "");
        assert_eq!(warnings.len(), 2);
    }

    #[test]
    fn unusable_character_json_is_rejected() {
        for json in [
            json!([]),
            json!({ "schema": 2, "id": "a", "model": "a.model3.json" }),
            json!({ "schema": 1, "id": "Not Valid", "model": "a.model3.json" }),
            json!({ "schema": 1, "id": "a" }),
            json!({ "schema": 1, "id": "a", "model": "../a.model3.json" }),
            json!({ "schema": 1, "id": "a", "model": "a.moc3" }),
        ] {
            assert!(parse_character(&json).is_err(), "{json}");
        }
    }

    #[test]
    fn written_json_parses_back() {
        let character = CharacterJson {
            id: "vts".into(),
            name: "阿库露_vts".into(),
            author: String::new(),
            license: String::new(),
            model: "model/阿库露_vts.model3.json".into(),
            extras: ModelExtras {
                expressions: vec![ExtraExpression {
                    name: "害羞脸".into(),
                    file: "害羞脸.exp3.json".into(),
                }],
                motion_groups: vec![],
            },
        };
        let (parsed, warnings) = parse_character(&character.to_json()).expect("round trip");
        assert_eq!(parsed, character);
        assert!(warnings.is_empty());
    }
}
