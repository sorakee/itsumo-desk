//! Provider profiles as Settings edits them (D61): created from a preset, edited, removed,
//! their keys set or cleared, and "Test connection".

use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager};
use tauri_specta::Event;
use tracing::warn;

use super::{
    first_token_timeout, is_plain_http_remote, presets, ChatDelta, ChatMessage, ChatRequest,
    ErrorKind, LlmError, PresetInfo, Role,
};
use crate::{
    events::ProvidersChanged,
    settings::{
        Capabilities, Keychain, KeychainError, Preset, ProviderProfile, Settings, SettingsStore,
    },
};

#[derive(Debug, thiserror::Error)]
pub enum ProviderError {
    #[error("no provider profile has the id {0}")]
    Unknown(String),
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Keychain(#[from] KeychainError),
    #[error(transparent)]
    Llm(#[from] LlmError),
    #[error("background task failed: {0}")]
    Task(String),
}

/// A profile as the settings window shows it. Carries whether a key is set, never the key.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSummary {
    pub id: String,
    pub name: String,
    pub preset: Preset,
    pub base_url: String,
    pub model: String,
    pub capabilities: Capabilities,
    pub key_set: bool,
    /// The profile chat uses (the head of the `main` role).
    pub main: bool,
    /// A key would be sent over plain HTTP to another machine.
    pub key_over_plain_http: bool,
}

/// The editable fields of a profile, sent whole on every edit.
#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUpdate {
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub capabilities: Capabilities,
}

/// What "Test connection" streams to the settings window.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TestEvent {
    /// A reasoning model started thinking; sent once.
    Thinking,
    Text {
        text: String,
    },
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TestReport {
    /// From sending the request to the first delta (thinking or text).
    pub first_token_ms: u32,
    /// The test stopped reading before the reply ended.
    pub truncated: bool,
}

const MAX_URL_CHARS: usize = 2048;
const MAX_MODEL_CHARS: usize = 256;
/// Credential Manager holds at most 2560 bytes, and keys are stored as UTF-16.
const MAX_KEY_CHARS: usize = 1024;
/// Enough reply to prove streaming works without paying for a long one.
const MAX_TEST_CHARS: usize = 300;
/// How long the test keeps reading after the first token (a reasoning model may think long).
const MAX_TEST_READ: Duration = Duration::from_secs(60);

pub fn preset_list() -> Vec<PresetInfo> {
    presets::PRESETS.into_iter().map(presets::info).collect()
}

pub async fn list(app: &AppHandle) -> Result<Vec<ProviderSummary>, ProviderError> {
    let settings = app.state::<SettingsStore>().get();
    let ids: Vec<String> = settings.providers.iter().map(|p| p.id.clone()).collect();
    let keys_set = keychain(app, move |keychain| {
        ids.iter()
            .map(|id| keychain.has_provider_key(id))
            .collect::<Result<Vec<_>, _>>()
    })
    .await?;
    let main = settings.roles.main.first();
    Ok(settings
        .providers
        .iter()
        .zip(keys_set)
        .map(|(profile, key_set)| summary(profile, main, key_set))
        .collect())
}

/// Creates a profile from a preset and returns its id. The first profile becomes chat's.
pub async fn add(app: &AppHandle, preset: Preset) -> Result<String, ProviderError> {
    let mut id = String::new();
    app.state::<SettingsStore>()
        .update(|settings| id = insert_new(settings, preset));
    // A profile removed while its credential could not be deleted may have left one behind.
    let stale = id.clone();
    if let Err(error) = keychain(app, move |keychain| keychain.delete_provider_key(&stale)).await {
        warn!(%error, "could not clear a stale key for a new provider profile");
    }
    emit_changed(app);
    Ok(id)
}

pub async fn update(
    app: &AppHandle,
    id: String,
    update: ProviderUpdate,
) -> Result<(), ProviderError> {
    let update = validated(update)?;
    let mut found = false;
    app.state::<SettingsStore>().update(|settings| {
        if let Some(profile) = settings.providers.iter_mut().find(|p| p.id == id) {
            found = true;
            profile.name = update.name;
            profile.base_url = update.base_url;
            profile.model = update.model;
            profile.capabilities = update.capabilities;
        }
    });
    if !found {
        return Err(ProviderError::Unknown(id));
    }
    emit_changed(app);
    Ok(())
}

/// Deletes the profile's key first, so a failure leaves no orphaned credential behind.
pub async fn remove(app: &AppHandle, id: String) -> Result<(), ProviderError> {
    profile(app, &id)?;
    let key_id = id.clone();
    keychain(app, move |keychain| keychain.delete_provider_key(&key_id)).await?;
    app.state::<SettingsStore>().update(|settings| {
        settings.providers.retain(|p| p.id != id);
        settings.roles.remove(&id);
    });
    emit_changed(app);
    Ok(())
}

/// Makes a profile the one chat uses, or with `None` leaves chat without one. Ordering
/// several arrives with the fallback chain (slice 5).
pub async fn set_main(app: &AppHandle, id: Option<String>) -> Result<(), ProviderError> {
    if let Some(id) = &id {
        profile(app, id)?;
    }
    app.state::<SettingsStore>()
        .update(|settings| settings.roles.main = id.into_iter().collect());
    emit_changed(app);
    Ok(())
}

pub async fn set_key(app: &AppHandle, id: String, key: String) -> Result<(), ProviderError> {
    let key = validated_key(&key)?;
    profile(app, &id)?;
    keychain(app, move |keychain| keychain.set_provider_key(&id, &key)).await?;
    emit_changed(app);
    Ok(())
}

pub async fn clear_key(app: &AppHandle, id: String) -> Result<(), ProviderError> {
    profile(app, &id)?;
    keychain(app, move |keychain| keychain.delete_provider_key(&id)).await?;
    emit_changed(app);
    Ok(())
}

/// The models the profile's server lists, for suggestions in the model field.
pub async fn models(app: &AppHandle, id: String) -> Result<Vec<String>, ProviderError> {
    let profile = ready_profile(app, &id, false)?;
    let key = keychain(app, move |keychain| keychain.provider_key(&id)).await?;
    let provider = super::provider(&profile, key);
    let wait = first_token_timeout(&profile.base_url);
    let models = tokio::time::timeout(wait, provider.models())
        .await
        .map_err(|_| LlmError::new(ErrorKind::Timeout, None))??;
    Ok(models)
}

/// Streams a one-sentence reply through `on_event`, which returns false once nobody is
/// listening (the settings window closed), ending the test early.
pub async fn test(
    app: &AppHandle,
    id: String,
    mut on_event: impl FnMut(TestEvent) -> bool + Send,
) -> Result<TestReport, ProviderError> {
    let profile = ready_profile(app, &id, true)?;
    let key = keychain(app, move |keychain| keychain.provider_key(&id)).await?;
    let provider = super::provider(&profile, key);
    let request = ChatRequest {
        messages: vec![
            ChatMessage {
                role: Role::System,
                content: "You are checking that a chat connection works.".into(),
            },
            ChatMessage {
                role: Role::User,
                content: "Reply with one short, friendly sentence.".into(),
            },
        ],
    };

    let started = Instant::now();
    let (mut stream, first) = tokio::time::timeout(first_token_timeout(&profile.base_url), async {
        let mut stream = provider.stream(request).await?;
        let first = stream.next().await;
        Ok::<_, LlmError>((stream, first))
    })
    .await
    .map_err(|_| LlmError::new(ErrorKind::Timeout, None))??;
    let first_token_ms = u32::try_from(started.elapsed().as_millis()).unwrap_or(u32::MAX);

    let stop_at = tokio::time::Instant::now() + MAX_TEST_READ;
    let mut next = first;
    let mut shown = 0;
    let mut thinking = false;
    let mut truncated = false;
    while let Some(delta) = next {
        let listening = match delta? {
            ChatDelta::Reasoning(_) if thinking => true,
            ChatDelta::Reasoning(_) => {
                thinking = true;
                on_event(TestEvent::Thinking)
            }
            ChatDelta::Text(text) => {
                let text: String = text.chars().take(MAX_TEST_CHARS - shown).collect();
                shown += text.chars().count();
                on_event(TestEvent::Text { text })
            }
        };
        if !listening {
            break;
        }
        if shown >= MAX_TEST_CHARS {
            truncated = true;
            break;
        }
        match tokio::time::timeout_at(stop_at, stream.next()).await {
            Ok(delta) => next = delta,
            Err(_) => {
                truncated = true;
                break;
            }
        }
    }
    Ok(TestReport {
        first_token_ms,
        truncated,
    })
}

fn summary(profile: &ProviderProfile, main: Option<&String>, key_set: bool) -> ProviderSummary {
    ProviderSummary {
        id: profile.id.clone(),
        name: profile.name.clone(),
        preset: profile.preset,
        base_url: profile.base_url.clone(),
        model: profile.model.clone(),
        capabilities: profile.capabilities,
        key_set,
        main: main == Some(&profile.id),
        key_over_plain_http: key_set && is_plain_http_remote(&profile.base_url),
    }
}

/// Adds a profile with the preset's defaults and returns its id.
fn insert_new(settings: &mut Settings, preset: Preset) -> String {
    let info = presets::info(preset);
    let id = crate::character::unique_id(presets::id_base(preset), |id| {
        settings.providers.iter().any(|p| p.id == id)
    });
    settings.providers.push(ProviderProfile {
        id: id.clone(),
        name: info.label,
        preset,
        base_url: info.base_url,
        model: info.model,
        capabilities: info.capabilities,
    });
    if settings.roles.main.is_empty() {
        settings.roles.main.push(id.clone());
    }
    id
}

fn profile(app: &AppHandle, id: &str) -> Result<ProviderProfile, ProviderError> {
    app.state::<SettingsStore>()
        .get()
        .providers
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| ProviderError::Unknown(id.to_owned()))
}

/// The profile, refused with a message to act on when it cannot be called yet.
fn ready_profile(
    app: &AppHandle,
    id: &str,
    needs_model: bool,
) -> Result<ProviderProfile, ProviderError> {
    let profile = profile(app, id)?;
    if profile.base_url.is_empty() {
        return Err(ProviderError::Invalid("Set a base URL first.".into()));
    }
    if needs_model && profile.model.is_empty() {
        return Err(ProviderError::Invalid("Set a model first.".into()));
    }
    Ok(profile)
}

fn validated(update: ProviderUpdate) -> Result<ProviderUpdate, ProviderError> {
    let name = match crate::character::display_name(&update.name) {
        Ok(Some(name)) => name,
        Ok(None) => return Err(ProviderError::Invalid("A profile needs a name.".into())),
        Err(why) => return Err(ProviderError::Invalid(capitalised(why))),
    };
    let model = update.model.trim().to_owned();
    if model.chars().count() > MAX_MODEL_CHARS || model.chars().any(char::is_control) {
        return Err(ProviderError::Invalid(format!(
            "The model name must be one line of at most {MAX_MODEL_CHARS} characters."
        )));
    }
    Ok(ProviderUpdate {
        name,
        base_url: base_url(&update.base_url)?,
        model,
        capabilities: update.capabilities,
    })
}

/// A base URL without a trailing slash, or empty while the user has not set one.
fn base_url(raw: &str) -> Result<String, ProviderError> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(String::new());
    }
    let invalid = |why: &str| ProviderError::Invalid(format!("The base URL {why}."));
    if raw.chars().count() > MAX_URL_CHARS {
        return Err(invalid("is too long"));
    }
    let url = Url::parse(raw)
        .map_err(|_| invalid("is not a valid URL; it starts with http:// or https://"))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(invalid(
            "must start with http:// or https:// and name a server",
        ));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid(
            "cannot contain a user name or password; the key goes in the key field",
        ));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(invalid("cannot have a query or fragment"));
    }
    Ok(url.as_str().trim_end_matches('/').to_owned())
}

fn validated_key(key: &str) -> Result<String, ProviderError> {
    let key = key.trim();
    if key.is_empty() {
        return Err(ProviderError::Invalid("The key is empty.".into()));
    }
    if key.chars().count() > MAX_KEY_CHARS {
        return Err(ProviderError::Invalid("The key is too long.".into()));
    }
    if !key.chars().all(|c| c.is_ascii_graphic()) {
        return Err(ProviderError::Invalid(
            "The key can only contain letters, digits and punctuation, without spaces.".into(),
        ));
    }
    Ok(key.to_owned())
}

fn capitalised(text: &str) -> String {
    let mut chars = text.chars();
    match chars.next() {
        Some(first) => format!("{}{}.", first.to_uppercase(), chars.as_str()),
        None => String::new(),
    }
}

async fn keychain<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&Keychain) -> Result<T, KeychainError> + Send + 'static,
) -> Result<T, ProviderError> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<Keychain>()))
        .await
        .map_err(|e| ProviderError::Task(e.to_string()))?
        .map_err(ProviderError::from)
}

fn emit_changed(app: &AppHandle) {
    if let Err(error) = ProvidersChanged.emit(app) {
        warn!(%error, "failed to announce a provider change");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_profiles_get_unique_ids_and_the_first_becomes_main() {
        let mut settings = Settings::default();
        assert_eq!(insert_new(&mut settings, Preset::Ollama), "ollama");
        assert_eq!(insert_new(&mut settings, Preset::Ollama), "ollama-2");
        assert_eq!(insert_new(&mut settings, Preset::OpenAi), "openai");
        assert_eq!(settings.roles.main, ["ollama"]);
        let ollama = &settings.providers[0];
        assert_eq!(ollama.base_url, "http://localhost:11434/v1");
        assert_eq!(ollama.name, "Ollama");
        assert!(settings.providers[2].capabilities.tools);
    }

    #[test]
    fn base_urls_are_normalised_and_checked() {
        assert_eq!(
            base_url("  http://localhost:11434/v1/ ").expect("ok"),
            "http://localhost:11434/v1"
        );
        assert_eq!(
            base_url("HTTPS://API.DeepSeek.com").expect("ok"),
            "https://api.deepseek.com"
        );
        assert_eq!(base_url("").expect("ok"), "");
        for bad in [
            "localhost:11434",
            "ftp://example.com",
            "https://user:pass@example.com/v1",
            "https://example.com/v1?key=1",
            "not a url",
        ] {
            assert!(base_url(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn updates_are_trimmed_and_checked() {
        let update = |name: &str, model: &str| ProviderUpdate {
            name: name.into(),
            base_url: "http://localhost:1234/v1".into(),
            model: model.into(),
            capabilities: Capabilities::default(),
        };
        let ok = validated(update("  Local  ", " qwen3:8b ")).expect("ok");
        assert_eq!((ok.name.as_str(), ok.model.as_str()), ("Local", "qwen3:8b"));
        assert!(validated(update("  ", "m")).is_err());
        assert!(validated(update("a\nb", "m")).is_err());
        assert!(validated(update("A", "two\nlines")).is_err());
        assert!(validated(update("A", &"m".repeat(MAX_MODEL_CHARS + 1))).is_err());
    }

    #[test]
    fn keys_are_trimmed_and_must_fit_a_header() {
        assert_eq!(validated_key("  sk-abc_123  ").expect("ok"), "sk-abc_123");
        assert!(validated_key("   ").is_err());
        assert!(validated_key("sk abc").is_err());
        assert!(validated_key("sk-ключ").is_err());
        assert!(validated_key(&"k".repeat(MAX_KEY_CHARS + 1)).is_err());
    }

    #[test]
    fn summaries_flag_keys_sent_in_the_clear() {
        let mut settings = Settings::default();
        let id = insert_new(&mut settings, Preset::Custom);
        let mut profile = settings.providers[0].clone();
        profile.base_url = "http://192.168.1.5:8080/v1".into();
        let main = Some(&id);
        assert!(summary(&profile, main, true).key_over_plain_http);
        assert!(!summary(&profile, main, false).key_over_plain_http);
        assert!(summary(&profile, main, false).main);
        profile.base_url = "http://localhost:8080/v1".into();
        assert!(!summary(&profile, None, true).key_over_plain_http);
    }
}
