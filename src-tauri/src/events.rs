//! Every backend→frontend event (D37). Each is a typed tauri-specta event; the TypeScript
//! side is generated into `src/ipc/bindings.ts`.

use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

use crate::character::{ActiveCharacter, Mapping};

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

/// The user saved or reset a character's mapping. Carries the mapping now in effect, so the
/// companion applies it without reloading the model.
#[derive(Debug, Clone, Serialize, Type, Event)]
pub struct MappingChanged {
    pub id: String,
    pub mapping: Option<Mapping>,
}

/// A character was installed or removed.
#[derive(Debug, Clone, Copy, Serialize, Type, Event)]
pub struct CharactersChanged;

/// A provider profile was added, edited or removed, its key was set or cleared, or chat
/// switched to another profile.
#[derive(Debug, Clone, Copy, Serialize, Type, Event)]
pub struct ProvidersChanged;

/// One segment of the companion's reply, a sentence or short utterance, sent as soon as it
/// is complete. The companion shows it as a subtitle; from M3 it also carries the speech.
/// `index` counts from 0 within the turn.
#[derive(Debug, Clone, Serialize, Type, Event)]
pub struct SpeechSegment {
    pub turn: u32,
    pub index: u32,
    pub text: String,
}

/// A chat turn is over: the reply ended, or `error` says why it stopped. An interrupted turn
/// sends nothing; the next turn's segments replace it.
#[derive(Debug, Clone, Serialize, Type, Event)]
pub struct TurnEnded {
    pub turn: u32,
    pub error: Option<String>,
}

/// The chat hotkey was pressed: the companion opens and focuses its chat input.
#[derive(Debug, Clone, Copy, Serialize, Type, Event)]
pub struct ChatRequested;
