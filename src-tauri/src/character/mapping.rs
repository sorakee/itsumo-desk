//! `mapping.json` (D19): which expression, motion or preset each slot and custom entry
//! plays. Packs may ship one; it is untrusted, so parsing keeps what it can and explains
//! what it dropped, and `check` reports targets the model does not have. Missing mappings
//! are warnings, never errors (`06-character-packs.md`).
//!
//! The user's edits are saved whole to `mapping.user.json` (D45): `validate` checks what the
//! editor sends and `to_json` writes it in the file's shape. Every field must go through
//! `parse`, `validate` and `to_json`, or saving an edit drops it.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use specta::Type;

use super::manifest::ModelManifest;

const SCHEMA: u64 = 1;

/// The fixed vocabulary the app relies on (`02-live2d.md`).
const CORE_SLOTS: [&str; 15] = [
    "idle",
    "talking",
    "greet",
    "yawn",
    "sleepy",
    "bored",
    "tapped_head",
    "tapped_body",
    "thinking",
    "neutral",
    "joy",
    "sad",
    "angry",
    "surprised",
    "shy",
];

/// Mirrors `PRESET_NAMES` in `src/live2d/presets.ts`.
const PRESETS: [&str; 5] = ["yawn", "nod", "headTilt", "lookAway", "doze"];

/// The slot the idle loop plays from; it takes motions only (D45).
const IDLE_SLOT: &str = "idle";

/// Custom entry names become output tags (`[smug]`), so they stay short and plain. Both
/// limits are mirrored in `src/windows/settings/mappingRules.ts`.
pub const MAX_CUSTOM_NAME_CHARS: usize = 32;
pub const MAX_DESCRIPTION_CHARS: usize = 120;

/// What a slot or custom entry plays. On the wire it has the file's shape:
/// `{ "expression": "exp_03" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Target {
    Expression(String),
    Motion(String),
    Preset(String),
}

impl Target {
    fn is_motion(&self) -> bool {
        matches!(self, Self::Motion(_))
    }

    /// The file's key for this kind of target, and the name it points at.
    fn parts(&self) -> (&'static str, &str) {
        match self {
            Self::Expression(name) => ("expression", name),
            Self::Motion(name) => ("motion", name),
            Self::Preset(name) => ("preset", name),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct CustomEntry {
    pub name: String,
    pub description: String,
    pub target: Target,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Mapping {
    pub slots: BTreeMap<String, Target>,
    pub custom: Vec<CustomEntry>,
    /// Parameter role → model parameter id, for models with non-standard ids.
    pub parameters: BTreeMap<String, String>,
    /// Expressions applied at rest, e.g. toggles that hide a watermark or pick an outfit.
    pub base_expressions: Vec<String>,
}

fn non_empty(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// A custom entry's name as the rules want it: trimmed, lower-case, with runs of spaces and
/// hyphens as one `_`. `None` if it still breaks them: empty, too long, other characters,
/// or a slot's name (the emotion tag would be ambiguous). Mirrored by `customName` in
/// `mappingRules.ts`.
pub fn custom_name(raw: &str) -> Option<String> {
    let name = raw
        .split(|c: char| c.is_whitespace() || c == '-')
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>()
        .join("_")
        .to_lowercase();
    let valid = !name.is_empty()
        && name.chars().count() <= MAX_CUSTOM_NAME_CHARS
        && name
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !CORE_SLOTS.contains(&name.as_str());
    valid.then_some(name)
}

/// A description on one line with single spaces, cut to `MAX_DESCRIPTION_CHARS`.
fn description(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(MAX_DESCRIPTION_CHARS)
        .collect()
}

fn target(entry: &Map<String, Value>) -> Option<Target> {
    if let Some(name) = non_empty(entry.get("expression")) {
        Some(Target::Expression(name.to_owned()))
    } else if let Some(name) = entry.get("motion").and_then(Value::as_str) {
        // Taken as is: model3.json allows any group name, the empty one included.
        Some(Target::Motion(name.to_owned()))
    } else {
        non_empty(entry.get("preset")).map(|name| Target::Preset(name.to_owned()))
    }
}

/// Parses `mapping.json`. Returns what was usable and a warning for everything dropped.
pub fn parse(json: &Value) -> (Mapping, Vec<String>) {
    let mut mapping = Mapping::default();
    let mut warnings = Vec::new();
    let Some(root) = json.as_object() else {
        warnings.push("mapping.json is not an object; ignored".to_owned());
        return (mapping, warnings);
    };
    match root.get("schema").and_then(Value::as_u64) {
        Some(SCHEMA) => {}
        Some(schema) if schema > SCHEMA => {
            warnings.push(format!(
                "mapping.json uses schema {schema}, which this version does not know; ignored"
            ));
            return (mapping, warnings);
        }
        _ => warnings.push("mapping.json has no valid schema; read as schema 1".to_owned()),
    }

    for (slot, entry) in root
        .get("slots")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if !CORE_SLOTS.contains(&slot.as_str()) {
            warnings.push(format!(
                "mapping slot \"{slot}\" is not a known slot; ignored"
            ));
            continue;
        }
        match entry.as_object().and_then(target) {
            Some(target) if slot == IDLE_SLOT && !target.is_motion() => {
                warnings.push("mapping slot \"idle\" takes motions only; ignored".to_owned());
            }
            Some(target) => {
                mapping.slots.insert(slot.clone(), target);
            }
            None => warnings.push(format!("mapping slot \"{slot}\" has no target; ignored")),
        }
    }

    for entry in root
        .get("custom")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(entry) = entry.as_object() else {
            continue;
        };
        let Some(raw) = non_empty(entry.get("name")) else {
            warnings.push("a custom mapping entry has no name; ignored".to_owned());
            continue;
        };
        let Some(name) = custom_name(raw) else {
            warnings.push(format!(
                "custom mapping \"{raw}\" needs a name of up to {MAX_CUSTOM_NAME_CHARS} letters, \
                 digits and _ that is not a slot's; ignored"
            ));
            continue;
        };
        if mapping.custom.iter().any(|c| c.name == name) {
            warnings.push(format!(
                "custom mapping \"{name}\" appears twice; kept the first"
            ));
            continue;
        }
        match target(entry) {
            Some(target) => mapping.custom.push(CustomEntry {
                description: description(
                    entry
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                ),
                name,
                target,
            }),
            None => warnings.push(format!("custom mapping \"{name}\" has no target; ignored")),
        }
    }

    for (role, id) in root
        .get("parameters")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        match non_empty(Some(id)) {
            Some(id) => {
                mapping.parameters.insert(role.clone(), id.to_owned());
            }
            None => warnings.push(format!("mapping parameter \"{role}\" has no id; ignored")),
        }
    }

    for name in root
        .get("baseExpressions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        match non_empty(Some(name)) {
            Some(name) if name.chars().any(char::is_control) => {
                warnings.push("a base expression has an invalid name; ignored".to_owned());
            }
            Some(name) if mapping.base_expressions.iter().any(|n| n == name) => {
                warnings.push(format!(
                    "base expression \"{name}\" appears twice; kept the first"
                ));
            }
            Some(name) => mapping.base_expressions.push(name.to_owned()),
            None => warnings.push("a base expression has no name; ignored".to_owned()),
        }
    }
    (mapping, warnings)
}

/// Checks a mapping from the editor before it is saved. Targets the model lacks are not
/// errors here; `check` reports them, as for a pack's own mapping.
pub fn validate(mapping: &Mapping) -> Result<(), String> {
    for (slot, target) in &mapping.slots {
        if !CORE_SLOTS.contains(&slot.as_str()) {
            return Err(format!("\"{slot}\" is not a mapping slot"));
        }
        if slot == IDLE_SLOT && !target.is_motion() {
            return Err("the idle slot takes motions only".to_owned());
        }
    }
    let mut names = Vec::new();
    for entry in &mapping.custom {
        if custom_name(&entry.name).as_deref() != Some(entry.name.as_str()) {
            return Err(format!(
                "\"{}\" is not a valid name: use up to {MAX_CUSTOM_NAME_CHARS} lower-case \
                 letters, digits and _, and no slot's name",
                entry.name
            ));
        }
        if names.contains(&&entry.name) {
            return Err(format!("two custom entries are named \"{}\"", entry.name));
        }
        names.push(&entry.name);
        if description(&entry.description) != entry.description {
            return Err(format!(
                "the description of \"{}\" must be one line of at most \
                 {MAX_DESCRIPTION_CHARS} characters",
                entry.name
            ));
        }
    }
    let targets = mapping
        .slots
        .values()
        .chain(mapping.custom.iter().map(|entry| &entry.target));
    for target in targets {
        let (kind, name) = target.parts();
        // Motion groups may have an empty name; nothing else may.
        if (!target.is_motion() && name.trim().is_empty()) || name.chars().any(char::is_control) {
            return Err(format!("a mapping target has an invalid {kind} name"));
        }
    }
    if mapping
        .parameters
        .iter()
        .any(|(role, id)| role.trim().is_empty() || id.trim().is_empty())
    {
        return Err("a parameter role or id is empty".to_owned());
    }
    for (i, name) in mapping.base_expressions.iter().enumerate() {
        if name.trim() != name || name.is_empty() || name.chars().any(char::is_control) {
            return Err("a base expression has an invalid name".to_owned());
        }
        if mapping.base_expressions[..i].contains(name) {
            return Err(format!("base expression \"{name}\" is listed twice"));
        }
    }
    Ok(())
}

/// The mapping in `mapping.json`'s shape, for `mapping.user.json`.
pub fn to_json(mapping: &Mapping) -> Value {
    let slots: Map<String, Value> = mapping
        .slots
        .iter()
        .map(|(slot, target)| {
            let (kind, name) = target.parts();
            (slot.clone(), json!({ kind: name }))
        })
        .collect();
    let custom: Vec<Value> = mapping
        .custom
        .iter()
        .map(|entry| {
            let (kind, name) = entry.target.parts();
            json!({ "name": entry.name, "description": entry.description, kind: name })
        })
        .collect();
    json!({
        "schema": SCHEMA,
        "slots": slots,
        "custom": custom,
        "parameters": mapping.parameters,
        "baseExpressions": mapping.base_expressions,
    })
}

fn missing(target: &Target, manifest: &ModelManifest) -> Option<String> {
    match target {
        Target::Expression(name) if !manifest.has_expression(name) => Some(format!(
            "expression \"{name}\", which the model does not have"
        )),
        Target::Motion(name) if !manifest.has_motion_group(name) => Some(format!(
            "motion group \"{name}\", which the model does not have"
        )),
        Target::Preset(name) if !PRESETS.contains(&name.as_str()) => {
            Some(format!("preset \"{name}\", which does not exist"))
        }
        _ => None,
    }
}

/// Warnings for mapping targets that the model (or the app) does not have. They are skipped
/// at runtime, like any manifest miss.
pub fn check(mapping: &Mapping, manifest: &ModelManifest) -> Vec<String> {
    let slots = mapping.slots.iter().filter_map(|(slot, target)| {
        missing(target, manifest).map(|what| format!("slot \"{slot}\" points at {what}"))
    });
    let custom = mapping.custom.iter().filter_map(|entry| {
        missing(&entry.target, manifest)
            .map(|what| format!("custom entry \"{}\" points at {what}", entry.name))
    });
    let parameters = mapping
        .parameters
        .iter()
        .filter(|(_, id)| !manifest.has_parameter(id))
        .map(|(role, id)| {
            format!("parameter \"{role}\" points at \"{id}\", which the model does not have")
        });
    let base = mapping
        .base_expressions
        .iter()
        .filter(|name| !manifest.has_expression(name))
        .map(|name| format!("base expression \"{name}\" is not an expression of the model"));
    slots.chain(custom).chain(parameters).chain(base).collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::character::manifest::{MotionGroupInfo, ParameterInfo};

    fn manifest() -> ModelManifest {
        ModelManifest {
            parameters: vec![ParameterInfo {
                id: "ParamMouthOpenY".into(),
                min: 0.0,
                max: 1.0,
                default: 0.0,
                name: None,
            }],
            expressions: vec!["exp_03".into()],
            motion_groups: vec![MotionGroupInfo {
                name: "Idle".into(),
                motions: vec!["idle.motion3.json".into()],
            }],
            hit_areas: vec![],
            standard_parameters: vec![],
            eye_blink_ids: vec![],
            lip_sync_ids: vec![],
        }
    }

    #[test]
    fn parses_the_documented_example() {
        let (mapping, warnings) = parse(&json!({
            "schema": 1,
            "slots": {
                "idle": { "motion": "Idle" },
                "joy": { "expression": "exp_03" },
                "yawn": { "preset": "yawn" }
            },
            "custom": [
                { "name": "smug", "description": "half-lidded grin", "expression": "exp_07" }
            ],
            "parameters": { "mouth_open": "ParamMouthOpenY" }
        }));
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(mapping.slots["idle"], Target::Motion("Idle".into()));
        assert_eq!(mapping.slots["yawn"], Target::Preset("yawn".into()));
        assert_eq!(mapping.custom[0].name, "smug");
        assert_eq!(mapping.custom[0].description, "half-lidded grin");
        assert_eq!(mapping.parameters["mouth_open"], "ParamMouthOpenY");
    }

    #[test]
    fn malformed_entries_are_dropped_with_warnings() {
        let (mapping, warnings) = parse(&json!({
            "slots": {
                "dance": { "motion": "Dance" },
                "joy": {},
                "sad": "exp_01"
            },
            "custom": [
                { "description": "no name", "expression": "x" },
                { "name": "a", "expression": "x" },
                { "name": "a", "expression": "y" },
                7
            ],
            "parameters": { "mouth_open": 3 },
            "baseExpressions": ["mask", " ", 4, "mask", "ab"]
        }));
        assert!(mapping.slots.is_empty());
        assert_eq!(mapping.custom.len(), 1);
        assert!(mapping.parameters.is_empty());
        assert_eq!(mapping.base_expressions, ["mask"]);
        // schema, dance, joy, sad, nameless, duplicate, parameter, and four base expressions
        assert_eq!(warnings.len(), 11, "{warnings:?}");
    }

    #[test]
    fn motion_groups_may_have_an_empty_name() {
        let (mapping, warnings) = parse(&json!({
            "schema": 1,
            "slots": { "idle": { "motion": "" }, "joy": { "expression": " " } }
        }));
        assert_eq!(mapping.slots["idle"], Target::Motion(String::new()));
        assert!(!mapping.slots.contains_key("joy"));
        assert_eq!(warnings.len(), 1, "{warnings:?}");
    }

    #[test]
    fn serialises_targets_in_the_file_shape() {
        let (mapping, _) = parse(&json!({
            "schema": 1,
            "slots": { "joy": { "expression": "exp_03" } },
            "custom": [{ "name": "smug", "motion": "Smug" }]
        }));
        assert_eq!(
            serde_json::to_value(&mapping).expect("serialises"),
            json!({
                "slots": { "joy": { "expression": "exp_03" } },
                "custom": [{ "name": "smug", "description": "", "target": { "motion": "Smug" } }],
                "parameters": {},
                "baseExpressions": []
            })
        );
    }

    #[test]
    fn custom_names_and_descriptions_follow_the_rules() {
        let long = "x".repeat(MAX_DESCRIPTION_CHARS + 10);
        let (mapping, warnings) = parse(&json!({
            "schema": 1,
            "slots": { "idle": { "expression": "exp_03" } },
            "custom": [
                { "name": " Smug  Face ", "description": "half-lidded\ngrin", "expression": "a" },
                { "name": "smug-face", "expression": "b" },
                { "name": "joy", "expression": "c" },
                { "name": "スマグ", "expression": "d" },
                { "name": "long", "description": long, "motion": "" }
            ]
        }));
        let names: Vec<_> = mapping.custom.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["smug_face", "long"]);
        assert_eq!(mapping.custom[0].description, "half-lidded grin");
        assert_eq!(
            mapping.custom[1].description.chars().count(),
            MAX_DESCRIPTION_CHARS
        );
        assert!(mapping.slots.is_empty());
        // idle, duplicate, slot name, non-ASCII
        assert_eq!(warnings.len(), 4, "{warnings:?}");
        assert_eq!(validate(&mapping), Ok(()));
    }

    #[test]
    fn validate_rejects_what_the_editor_must_not_send() {
        let entry = |name: &str, description: &str| CustomEntry {
            name: name.into(),
            description: description.into(),
            target: Target::Expression("a".into()),
        };
        let with_slot = |slot: &str, target: Target| Mapping {
            slots: BTreeMap::from([(slot.to_owned(), target)]),
            ..Mapping::default()
        };
        let with_custom = |custom: Vec<CustomEntry>| Mapping {
            custom,
            ..Mapping::default()
        };
        let with_base = |names: &[&str]| Mapping {
            base_expressions: names.iter().map(|&n| n.to_owned()).collect(),
            ..Mapping::default()
        };
        assert_eq!(validate(&Mapping::default()), Ok(()));
        assert_eq!(validate(&with_base(&["水印开关", "mask"])), Ok(()));
        assert_eq!(
            validate(&with_slot("idle", Target::Motion(String::new()))),
            Ok(())
        );
        for invalid in [
            with_slot("dance", Target::Motion("Dance".into())),
            with_slot("idle", Target::Preset("doze".into())),
            with_slot("joy", Target::Expression(" ".into())),
            with_slot("joy", Target::Expression("a\nb".into())),
            with_custom(vec![entry("Smug", "")]),
            with_custom(vec![entry("joy", "")]),
            with_custom(vec![entry("smug", " padded")]),
            with_custom(vec![entry("smug", &"x".repeat(MAX_DESCRIPTION_CHARS + 1))]),
            with_custom(vec![entry("smug", ""), entry("smug", "")]),
            Mapping {
                parameters: BTreeMap::from([("ParamAngleX".to_owned(), String::new())]),
                ..Mapping::default()
            },
            with_base(&[""]),
            with_base(&[" mask"]),
            with_base(&["a
b"]),
            with_base(&["mask", "mask"]),
        ] {
            assert!(validate(&invalid).is_err(), "{invalid:?}");
        }
    }

    #[test]
    fn written_json_parses_back() {
        let mapping = Mapping {
            slots: BTreeMap::from([
                ("idle".to_owned(), Target::Motion(String::new())),
                ("joy".to_owned(), Target::Expression("笑顔".into())),
                ("yawn".to_owned(), Target::Preset("yawn".into())),
            ]),
            custom: vec![CustomEntry {
                name: "smug".into(),
                description: "half-lidded grin".into(),
                target: Target::Motion("Smug".into()),
            }],
            parameters: BTreeMap::from([("ParamAngleX".to_owned(), "Param72".to_owned())]),
            base_expressions: vec!["水印开关".into(), "mask".into()],
        };
        let written = to_json(&mapping);
        assert_eq!(
            written["custom"][0],
            json!({ "name": "smug", "description": "half-lidded grin", "motion": "Smug" })
        );
        let (parsed, warnings) = parse(&written);
        assert!(warnings.is_empty(), "{warnings:?}");
        assert_eq!(parsed, mapping);
    }

    #[test]
    fn the_editor_sends_targets_in_the_file_shape() {
        let mapping: Mapping = serde_json::from_value(json!({
            "slots": { "joy": { "expression": "exp_03" } },
            "custom": [{ "name": "smug", "description": "", "target": { "motion": "" } }],
            "parameters": {},
            "baseExpressions": ["exp_03"]
        }))
        .expect("deserialises");
        assert_eq!(mapping.base_expressions, ["exp_03"]);
        assert_eq!(mapping.slots["joy"], Target::Expression("exp_03".into()));
        assert_eq!(mapping.custom[0].target, Target::Motion(String::new()));
    }

    #[test]
    fn newer_schema_is_ignored() {
        let (mapping, warnings) =
            parse(&json!({ "schema": 2, "slots": { "joy": { "expression": "x" } } }));
        assert_eq!(mapping, Mapping::default());
        assert_eq!(warnings.len(), 1);
    }

    #[test]
    fn check_reports_targets_the_model_lacks() {
        let (mapping, _) = parse(&json!({
            "schema": 1,
            "slots": {
                "idle": { "motion": "Idle" },
                "joy": { "expression": "exp_03" },
                "sad": { "expression": "exp_99" },
                "greet": { "motion": "Wave" },
                "yawn": { "preset": "stretch" }
            },
            "custom": [{ "name": "smug", "expression": "exp_07" }],
            "parameters": { "mouth_open": "ParamMouthOpenY", "mouth_form": "PARAM_FORM" },
            "baseExpressions": ["exp_03", "watermark"]
        }));
        let warnings = check(&mapping, &manifest());
        assert_eq!(warnings.len(), 6, "{warnings:?}");
        assert!(warnings.iter().any(|w| w.contains("watermark")));
        assert!(warnings.iter().any(|w| w.contains("exp_99")));
        assert!(warnings.iter().any(|w| w.contains("Wave")));
        assert!(warnings.iter().any(|w| w.contains("stretch")));
        assert!(warnings.iter().any(|w| w.contains("smug")));
        assert!(warnings.iter().any(|w| w.contains("PARAM_FORM")));
    }
}
