//! Every backend→frontend event (D37). Each is a typed tauri-specta event; the TypeScript
//! side is generated into `src/ipc/bindings.ts`.

use serde::Serialize;
use specta::Type;
use tauri_specta::Event;

/// The global cursor, relative to the companion's client area in CSS pixels. Values outside
/// the window's size mean the cursor is elsewhere on the desktop.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Type, Event)]
pub struct CursorMoved {
    pub x: f64,
    pub y: f64,
}

/// The user asked to reset the companion (tray menu): restore the model's default framing
/// and forget the saved one.
#[derive(Debug, Clone, Copy, Serialize, Type, Event)]
pub struct ResetFraming;
