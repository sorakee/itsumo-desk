//! The model manifest (D34): what a model actually has. Only the Cubism Core can read a
//! `.moc3`, so the webview builds it (`src/live2d/manifest.ts`) and sends it here; this is
//! the wire type, and the frontend's runtime type must stay assignable to it.

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModelManifest {
    /// In moc order.
    pub parameters: Vec<ParameterInfo>,
    pub expressions: Vec<String>,
    pub motion_groups: Vec<MotionGroupInfo>,
    pub hit_areas: Vec<HitAreaInfo>,
    pub standard_parameters: Vec<String>,
    pub eye_blink_ids: Vec<String>,
    pub lip_sync_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct ParameterInfo {
    pub id: String,
    pub min: f64,
    pub max: f64,
    pub default: f64,
    /// Display name from `cdi3.json`, when the model ships one.
    #[specta(optional)]
    pub name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct MotionGroupInfo {
    pub name: String,
    pub motions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
pub struct HitAreaInfo {
    pub id: String,
    pub name: String,
}

impl ModelManifest {
    pub fn has_parameter(&self, id: &str) -> bool {
        self.parameters.iter().any(|p| p.id == id)
    }

    pub fn has_expression(&self, name: &str) -> bool {
        self.expressions.iter().any(|e| e == name)
    }

    pub fn has_motion_group(&self, name: &str) -> bool {
        self.motion_groups.iter().any(|g| g.name == name)
    }
}
