//! Every backend→frontend event (D37). Each is a typed tauri-specta event; the TypeScript
//! side is generated into `src/ipc/bindings.ts`.

use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use crate::character::ActiveCharacter;

/// The global cursor, relative to the companion's client area in CSS pixels. Values outside
/// the window's size mean the cursor is elsewhere on the desktop.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Type, Event)]
pub struct CursorMoved {
    pub x: f64,
    pub y: f64,
}

/// The companion's always-on-top setting changed, from the tray or the companion menu.
#[derive(Debug, Clone, Copy, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct AlwaysOnTopChanged {
    pub always_on_top: bool,
}

/// The user asked to reset the companion (tray menu): restore the model's default framing
/// and forget the saved one.
#[derive(Debug, Clone, Copy, Serialize, Type, Event)]
pub struct ResetFraming;

/// The active character changed, was replaced by a re-import, or was removed (`None`).
#[derive(Debug, Clone, Serialize, Type, Event)]
pub struct ActiveCharacterChanged {
    pub character: Option<ActiveCharacter>,
}

/// A character was installed or removed.
#[derive(Debug, Clone, Copy, Serialize, Type, Event)]
pub struct CharactersChanged;
