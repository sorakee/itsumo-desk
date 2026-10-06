//! `mapping.json` (D19): which expression, motion or preset each slot and custom entry
//! plays. Packs may ship one; it is untrusted, so parsing keeps what it can and explains
//! what it dropped, and `check` reports targets the model does not have. Missing mappings
//! are warnings, never errors (`06-character-packs.md`).

use std::collections::BTreeMap;

use serde::Serialize;
use serde_json::{Map, Value};
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

/// What a slot or custom entry plays. On the wire it has the file's shape:
/// `{ "expression": "exp_03" }`.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum Target {
    Expression(String),
    Motion(String),
    Preset(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
pub struct CustomEntry {
    pub name: String,
    pub description: String,
    pub target: Target,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Type)]
pub struct Mapping {
    pub slots: BTreeMap<String, Target>,
    pub custom: Vec<CustomEntry>,
    /// Parameter role → model parameter id, for models with non-standard ids.
    pub parameters: BTreeMap<String, String>,
}

fn non_empty(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
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
        let Some(name) = non_empty(entry.get("name")) else {
            warnings.push("a custom mapping entry has no name; ignored".to_owned());
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
                name: name.to_owned(),
                description: non_empty(entry.get("description"))
                    .unwrap_or_default()
                    .to_owned(),
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
    (mapping, warnings)
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
    slots.chain(custom).chain(parameters).collect()
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
            "parameters": { "mouth_open": 3 }
        }));
        assert!(mapping.slots.is_empty());
        assert_eq!(mapping.custom.len(), 1);
        assert!(mapping.parameters.is_empty());
        // schema, dance, joy, sad, nameless, duplicate, parameter
        assert_eq!(warnings.len(), 7, "{warnings:?}");
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
                "parameters": {}
            })
        );
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
            "parameters": { "mouth_open": "ParamMouthOpenY", "mouth_form": "PARAM_FORM" }
        }));
        let warnings = check(&mapping, &manifest());
        assert_eq!(warnings.len(), 5, "{warnings:?}");
        assert!(warnings.iter().any(|w| w.contains("exp_99")));
        assert!(warnings.iter().any(|w| w.contains("Wave")));
        assert!(warnings.iter().any(|w| w.contains("stretch")));
        assert!(warnings.iter().any(|w| w.contains("smug")));
        assert!(warnings.iter().any(|w| w.contains("PARAM_FORM")));
    }
}
