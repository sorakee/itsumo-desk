//! The files a `model3.json` references. The webview parses the model for rendering
//! (`src/live2d/modelSettings.ts`); the core only needs to know which files belong to it.

use serde_json::Value;

use super::{paths::safe_relative_path, CharacterError};

/// Files referenced by a `model3.json`, as safe relative paths from its folder.
#[derive(Debug, Default, PartialEq)]
pub struct ModelFiles {
    /// The moc and textures: the model cannot load without them.
    pub required: Vec<String>,
    /// Physics, pose, display info, user data, expressions, motions and sounds.
    pub optional: Vec<String>,
    pub expression_names: Vec<String>,
    pub motion_groups: Vec<String>,
    /// Each expression's name and file, for matching files back to names.
    pub expression_files: Vec<(String, String)>,
    /// Each motion's group and file.
    pub motion_files: Vec<(String, String)>,
    /// References that were dropped because they are not safe relative paths.
    pub rejected: Vec<String>,
}

impl ModelFiles {
    /// The moc, which `parse` puts first in `required`.
    pub fn moc(&self) -> &str {
        self.required.first().map_or("", String::as_str)
    }

    /// The textures, which follow the moc in `required`.
    pub fn textures(&self) -> &[String] {
        self.required.get(1..).unwrap_or_default()
    }

    /// Records an optional file and returns its safe path, if it has one.
    fn optional(&mut self, value: Option<&Value>) -> Option<String> {
        let raw = value.and_then(Value::as_str)?;
        let Some(path) = safe_relative_path(raw) else {
            self.rejected.push(raw.to_owned());
            return None;
        };
        if !self.optional.contains(&path) {
            self.optional.push(path.clone());
        }
        Some(path)
    }
}

/// Reads the file references, tolerating anything malformed except a missing moc or texture
/// list (the same rule as the frontend parser).
pub fn parse(json: &Value) -> Result<ModelFiles, CharacterError> {
    let invalid = |reason: &str| CharacterError::InvalidModel(reason.to_owned());
    let refs = json
        .get("FileReferences")
        .filter(|refs| refs.is_object())
        .ok_or_else(|| invalid("model3.json has no FileReferences"))?;

    let mut files = ModelFiles::default();
    let moc = refs
        .get("Moc")
        .and_then(Value::as_str)
        .and_then(safe_relative_path)
        .ok_or_else(|| invalid("model3.json has no valid Moc reference"))?;
    files.required.push(moc);
    let textures = refs
        .get("Textures")
        .and_then(Value::as_array)
        .filter(|textures| !textures.is_empty())
        .ok_or_else(|| invalid("model3.json has no Textures"))?;
    for texture in textures {
        let path = texture
            .as_str()
            .and_then(safe_relative_path)
            .ok_or_else(|| invalid("model3.json has an invalid texture reference"))?;
        files.required.push(path);
    }

    for key in ["Physics", "Pose", "DisplayInfo", "UserData"] {
        files.optional(refs.get(key));
    }
    for expression in refs
        .get("Expressions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let name = expression.get("Name").and_then(Value::as_str);
        if let Some(name) = name {
            files.expression_names.push(name.to_owned());
        }
        if let (Some(name), Some(file)) = (name, files.optional(expression.get("File"))) {
            files.expression_files.push((name.to_owned(), file));
        }
    }
    for (group, motions) in refs
        .get("Motions")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        files.motion_groups.push(group.clone());
        for motion in motions.as_array().into_iter().flatten() {
            if let Some(file) = files.optional(motion.get("File")) {
                files.motion_files.push((group.clone(), file));
            }
            files.optional(motion.get("Sound"));
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn collects_every_reference() {
        let files = parse(&json!({
            "FileReferences": {
                "Moc": "m.moc3",
                "Textures": ["m.4096/texture_00.png", "m.4096\\texture_01.png"],
                "Physics": "m.physics3.json",
                "DisplayInfo": "m.cdi3.json",
                "Expressions": [{ "Name": "smile", "File": "exp/smile.exp3.json" }],
                "Motions": {
                    "Idle": [{ "File": "motion/idle.motion3.json", "Sound": "s.wav" }],
                    "Tap": [{ "File": "motion/idle.motion3.json" }]
                }
            }
        }))
        .expect("valid model");
        assert_eq!(
            files.required,
            ["m.moc3", "m.4096/texture_00.png", "m.4096/texture_01.png"]
        );
        assert_eq!(
            files.optional,
            [
                "m.physics3.json",
                "m.cdi3.json",
                "exp/smile.exp3.json",
                "motion/idle.motion3.json",
                "s.wav"
            ]
        );
        assert_eq!(files.expression_names, ["smile"]);
        assert_eq!(files.motion_groups, ["Idle", "Tap"]);
        assert_eq!(
            files.expression_files,
            [("smile".to_owned(), "exp/smile.exp3.json".to_owned())]
        );
        assert_eq!(files.motion_files.len(), 2);
        assert!(files.rejected.is_empty());
    }

    #[test]
    fn unsafe_optional_references_are_rejected_not_fatal() {
        let files = parse(&json!({
            "FileReferences": {
                "Moc": "m.moc3",
                "Textures": ["t.png"],
                "Physics": "../../secret.json",
                "Pose": 7
            }
        }))
        .expect("valid model");
        assert!(files.optional.is_empty());
        assert_eq!(files.rejected, ["../../secret.json"]);
    }

    #[test]
    fn missing_moc_or_textures_is_fatal() {
        for json in [
            json!({}),
            json!({ "FileReferences": { "Textures": ["t.png"] } }),
            json!({ "FileReferences": { "Moc": "../m.moc3", "Textures": ["t.png"] } }),
            json!({ "FileReferences": { "Moc": "m.moc3", "Textures": [] } }),
            json!({ "FileReferences": { "Moc": "m.moc3", "Textures": ["t.png", "/abs.png"] } }),
        ] {
            assert!(parse(&json).is_err(), "{json}");
        }
    }
}
