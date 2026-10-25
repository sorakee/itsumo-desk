//! The global chat hotkey (D57). It opens the companion's chat input from anywhere, can be
//! rebound in Settings, and a registration Windows refuses is shown there.

use std::{
    str::FromStr,
    sync::{Mutex, MutexGuard, PoisonError},
};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};
use tauri_specta::Event;
use tracing::warn;

use crate::{events::ChatRequested, settings::SettingsStore};

/// Ctrl+Space toggles IMEs and Alt+Space opens the window menu, so both modifiers.
const DEFAULT: &str = "Ctrl+Alt+Space";

#[derive(Debug, thiserror::Error)]
pub enum HotkeyError {
    #[error("{0}")]
    Invalid(&'static str),
    #[error("Windows would not register {0}. Another app may be using it.")]
    Refused(String),
}

/// The chat hotkey as Settings shows it.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    /// Modifiers first, then the key, e.g. `Ctrl+Alt+Space`.
    pub shortcut: String,
    pub is_default: bool,
    /// Why the shortcut is not registered; it does nothing until this is fixed.
    pub error: Option<String>,
}

/// What is registered with the OS now, and why the saved shortcut is not, if it is not.
#[derive(Default)]
struct Registration {
    shortcut: Option<Shortcut>,
    error: Option<String>,
}

#[derive(Default)]
struct Hotkey(Mutex<Registration>);

impl Hotkey {
    fn lock(&self) -> MutexGuard<'_, Registration> {
        // Each field is written in one statement, so a panic cannot leave them torn.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, _shortcut, event| on_shortcut(app, event))
        .build()
}

/// Registers the saved shortcut. A refusal is kept for Settings, not treated as fatal.
pub fn init(app: &AppHandle) {
    app.manage(Hotkey::default());
    let saved = app.state::<SettingsStore>().get().companion.chat_hotkey;
    let (shortcut, text) = match saved.as_deref().map(parse) {
        Some(Ok(parsed)) => parsed,
        Some(Err(error)) => {
            warn!(%error, "the saved chat hotkey is invalid; using the default");
            default()
        }
        None => default(),
    };
    let result = app.global_shortcut().register(shortcut);
    let mut registration = app.state::<Hotkey>().inner().lock();
    match result {
        Ok(()) => registration.shortcut = Some(shortcut),
        Err(error) => {
            warn!(%error, "could not register the chat hotkey");
            registration.error = Some(HotkeyError::Refused(text).to_string());
        }
    }
}

pub fn status(app: &AppHandle) -> HotkeyStatus {
    let saved = app.state::<SettingsStore>().get().companion.chat_hotkey;
    let error = app.state::<Hotkey>().inner().lock().error.clone();
    HotkeyStatus {
        is_default: saved.is_none(),
        shortcut: saved.unwrap_or_else(|| DEFAULT.to_owned()),
        error,
    }
}

/// Registers `shortcut` in place of the current one and saves it; `None` goes back to the
/// default. If Windows refuses it, the previous shortcut stays.
pub fn set(app: &AppHandle, shortcut: Option<&str>) -> Result<HotkeyStatus, HotkeyError> {
    let (next, text) = match shortcut {
        Some(text) => parse(text)?,
        None => default(),
    };
    {
        let state = app.state::<Hotkey>();
        let mut registration = state.inner().lock();
        let previous = registration.shortcut;
        if previous != Some(next) {
            let manager = app.global_shortcut();
            if let Some(previous) = previous {
                if let Err(error) = manager.unregister(previous) {
                    warn!(%error, "could not unregister the previous chat hotkey");
                }
                registration.shortcut = None;
            }
            if let Err(error) = manager.register(next) {
                warn!(%error, "could not register the new chat hotkey");
                if let Some(previous) = previous {
                    if manager.register(previous).is_ok() {
                        registration.shortcut = Some(previous);
                    }
                }
                return Err(HotkeyError::Refused(text));
            }
            registration.shortcut = Some(next);
        }
        registration.error = None;
    }
    let saved = (text != DEFAULT).then_some(text);
    app.state::<SettingsStore>()
        .update(|settings| settings.companion.chat_hotkey = saved);
    Ok(status(app))
}

fn on_shortcut(app: &AppHandle, event: ShortcutEvent) {
    if event.state != ShortcutState::Pressed {
        return;
    }
    // Shows the companion if it is hidden and gives it focus, which the hotkey's owner is
    // allowed to take.
    super::show_companion(app);
    if let Err(error) = ChatRequested.emit(app) {
        warn!(%error, "failed to ask the companion to open chat");
    }
}

fn default() -> (Shortcut, String) {
    let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    (shortcut, DEFAULT.to_owned())
}

/// Parses a shortcut written as `Ctrl+Alt+Space` (key names as in `KeyboardEvent.code`) and
/// returns it with its text in a fixed form.
fn parse(text: &str) -> Result<(Shortcut, String), HotkeyError> {
    if text.len() > 64 {
        return Err(HotkeyError::Invalid("That is not a keyboard shortcut."));
    }
    let shortcut = Shortcut::from_str(text)
        .map_err(|_| HotkeyError::Invalid("That is not a keyboard shortcut."))?;
    if !shortcut
        .mods
        .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SUPER)
    {
        return Err(HotkeyError::Invalid(
            "Use Ctrl, Alt or Win in the shortcut, so it does not take over a key you type with.",
        ));
    }
    let mut parts = Vec::new();
    for (modifier, name) in [
        (Modifiers::CONTROL, "Ctrl"),
        (Modifiers::ALT, "Alt"),
        (Modifiers::SHIFT, "Shift"),
        (Modifiers::SUPER, "Win"),
    ] {
        if shortcut.mods.contains(modifier) {
            parts.push(name.to_owned());
        }
    }
    let key = shortcut.key.to_string();
    let key = key
        .strip_prefix("Key")
        .or_else(|| key.strip_prefix("Digit"))
        .unwrap_or(&key);
    parts.push(key.to_owned());
    Ok((shortcut, parts.join("+")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shortcuts_are_parsed_into_a_fixed_form() {
        assert_eq!(parse(DEFAULT).expect("parses"), default());
        let text = |raw: &str| parse(raw).map(|(_, text)| text).ok();
        assert_eq!(text("alt+ctrl+space").as_deref(), Some(DEFAULT));
        assert_eq!(text("Ctrl+Shift+KeyK").as_deref(), Some("Ctrl+Shift+K"));
        assert_eq!(text("Super+Digit1").as_deref(), Some("Win+1"));
        assert_eq!(text("Ctrl+Alt+F5").as_deref(), Some("Ctrl+Alt+F5"));
        // The fixed form parses back to the same shortcut.
        let (shortcut, fixed) = parse("Ctrl+Shift+KeyK").expect("parses");
        assert_eq!(parse(&fixed).expect("parses").0, shortcut);
    }

    #[test]
    fn shortcuts_need_a_modifier_that_does_not_type() {
        for bad in ["Space", "Shift+KeyA", "Ctrl+Alt", "Ctrl+Nope", "", "Ctrl++"] {
            assert!(parse(bad).is_err(), "{bad}");
        }
        assert!(parse(&format!("Ctrl+{}", "A".repeat(80))).is_err());
    }
}
