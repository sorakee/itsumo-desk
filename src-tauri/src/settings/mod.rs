//! User settings persisted to `%APPDATA%/itsumo-desk/config.json`.

mod store;

pub use store::SettingsStore;

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub companion: CompanionSettings,
    /// The id of the character pack the companion shows; `None` until one is imported.
    pub active_character: Option<String>,
    /// Per-character preferences, keyed by character id.
    pub characters: BTreeMap<String, CharacterSettings>,
}

impl Settings {
    /// Brings hand-edited or stale values back into range so nothing downstream has to.
    fn sanitized(mut self) -> Self {
        self.companion.scale = clamp_scale(self.companion.scale);
        self.active_character = self
            .active_character
            .filter(|id| crate::character::is_valid_id(id));
        for character in self.characters.values_mut() {
            character.framing = character.framing.and_then(Framing::validated);
        }
        self
    }
}

pub const MIN_SCALE: f64 = 0.5;
pub const MAX_SCALE: f64 = 2.0;

pub fn clamp_scale(scale: f64) -> f64 {
    if scale.is_finite() {
        scale.clamp(MIN_SCALE, MAX_SCALE)
    } else {
        1.0
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CompanionSettings {
    /// Outer position in physical pixels on the virtual desktop. `None` until the window
    /// has been moved once.
    pub position: Option<WindowPosition>,
    pub always_on_top: bool,
    /// Window size as a multiple of the base 480×640 logical pixels.
    pub scale: f64,
}

impl Default for CompanionSettings {
    fn default() -> Self {
        Self {
            position: None,
            always_on_top: true,
            scale: 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct CharacterSettings {
    /// `None` until the user adjusts it; the frontend then derives a default from the model.
    pub framing: Option<Framing>,
}

/// Which part of the model fills the companion window, in model units (the model canvas is
/// 2 units tall, centred on the origin). Independent of the window's size.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Framing {
    /// How many window heights the model canvas spans; 1 fits it exactly.
    pub zoom: f64,
    /// The model-space point shown at the window's centre. Older files have no `centerX`;
    /// 0 is the canvas centre, where models are normally drawn.
    #[serde(default)]
    pub center_x: f64,
    pub center_y: f64,
}

impl Framing {
    const ZOOM_RANGE: (f64, f64) = (0.25, 8.0);
    const CENTER_RANGE: (f64, f64) = (-2.0, 2.0);

    /// Clamps to a range that keeps some of the model on screen; `None` if not finite.
    pub fn validated(self) -> Option<Self> {
        if !self.zoom.is_finite() || !self.center_x.is_finite() || !self.center_y.is_finite() {
            return None;
        }
        Some(Self {
            zoom: self.zoom.clamp(Self::ZOOM_RANGE.0, Self::ZOOM_RANGE.1),
            center_x: self
                .center_x
                .clamp(Self::CENTER_RANGE.0, Self::CENTER_RANGE.1),
            center_y: self
                .center_y
                .clamp(Self::CENTER_RANGE.0, Self::CENTER_RANGE.1),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_is_clamped_and_non_finite_is_rejected() {
        let wild = Framing {
            zoom: 100.0,
            center_x: 3.0,
            center_y: -9.0,
        };
        assert_eq!(
            wild.validated(),
            Some(Framing {
                zoom: 8.0,
                center_x: 2.0,
                center_y: -2.0
            })
        );
        let broken = Framing {
            zoom: 1.0,
            center_x: f64::NAN,
            center_y: 0.0,
        };
        assert_eq!(broken.validated(), None);
    }

    #[test]
    fn scale_is_clamped_and_non_finite_resets() {
        assert_eq!(clamp_scale(5.0), MAX_SCALE);
        assert_eq!(clamp_scale(0.1), MIN_SCALE);
        assert_eq!(clamp_scale(f64::INFINITY), 1.0);
        assert_eq!(clamp_scale(1.25), 1.25);
    }
}
