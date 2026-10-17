//! LLM providers (D7, D61): the `LlmProvider` trait, its adapters, and the provider profiles
//! the user sets up in Settings.

mod error;
mod openai_compat;
mod presets;
mod profiles;
mod sse;

use std::{net::IpAddr, sync::OnceLock, time::Duration};

use futures_util::{future::BoxFuture, stream::BoxStream};
use reqwest::Url;
use serde::Serialize;

pub use error::{ErrorKind, LlmError};
pub use presets::PresetInfo;
pub use profiles::{
    add, clear_key, list, models, preset_list, remove, set_key, set_main, test, update,
    ProviderError, ProviderSummary, ProviderUpdate, TestEvent, TestReport,
};

use crate::settings::ProviderProfile;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
}

/// A piece of a streamed reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ChatDelta {
    Text(String),
    /// A reasoning model's thinking, sent before its reply. Never shown as the reply.
    Reasoning(String),
}

/// The reply as it arrives. It ends after the last delta, or with one error.
pub type DeltaStream = BoxStream<'static, Result<ChatDelta, LlmError>>;

pub trait LlmProvider: Send + Sync {
    /// Starts a streamed reply. Resolves once the provider has accepted the request, so
    /// status and connection errors come from here and later ones from the stream.
    fn stream(&self, request: ChatRequest) -> BoxFuture<'_, Result<DeltaStream, LlmError>>;

    /// The model names the server offers, for the model field's suggestions.
    fn models(&self) -> BoxFuture<'_, Result<Vec<String>, LlmError>>;
}

/// The adapter for a profile. Every preset so far speaks the OpenAI-compatible API.
pub fn provider(profile: &ProviderProfile, key: Option<String>) -> Box<dyn LlmProvider> {
    Box::new(openai_compat::OpenAiCompat::new(
        profile.base_url.clone(),
        profile.model.clone(),
        key,
    ))
}

/// How long to wait for the first token: local servers may be loading the model from disk.
pub fn first_token_timeout(base_url: &str) -> Duration {
    if is_local(base_url) {
        Duration::from_secs(120)
    } else {
        Duration::from_secs(30)
    }
}

/// Loopback or a private network address: a server the user runs.
fn is_local(base_url: &str) -> bool {
    let Some(host) = host(base_url) else {
        return false;
    };
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Ok(IpAddr::V6(ip)) => {
            ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local()
        }
        Err(_) => host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local"),
    }
}

/// The URL's host, with an IPv6 address unbracketed.
fn host(base_url: &str) -> Option<String> {
    let url = Url::parse(base_url).ok()?;
    let host = url.host_str()?.trim_matches(['[', ']']);
    Some(host.to_owned())
}

/// Plain HTTP to anything but this machine: a key would cross the network readable.
fn is_plain_http_remote(base_url: &str) -> bool {
    let loopback = host(base_url).is_some_and(|host| {
        host == "localhost" || host.parse::<IpAddr>().is_ok_and(|ip| ip.is_loopback())
    });
    base_url.starts_with("http://") && !loopback
}

/// Built on first use and shared, so connections to a provider are reused between turns.
fn client() -> Result<&'static reqwest::Client, LlmError> {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("itsumo-desk/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        // Per read, so it bounds a stall mid-reply; longer than the first-token timeout.
        .read_timeout(Duration::from_secs(150))
        .build()
        .map_err(|error| LlmError::from_transport(&error))?;
    Ok(CLIENT.get_or_init(|| client))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_servers_get_the_long_timeout() {
        for url in [
            "http://localhost:11434/v1",
            "http://127.0.0.1:1234/v1",
            "http://192.168.1.20:11434/v1",
            "http://[::1]:8080/v1",
            "http://desktop.local:1234/v1",
        ] {
            assert!(is_local(url), "{url}");
        }
        assert!(!is_local("https://api.openai.com/v1"));
        assert!(!is_local("http://8.8.8.8/v1"));
        assert!(
            first_token_timeout("https://api.deepseek.com/v1")
                < first_token_timeout("http://localhost:1234/v1")
        );
    }

    #[test]
    fn only_plain_http_off_this_machine_is_flagged() {
        assert!(is_plain_http_remote("http://192.168.1.20:11434/v1"));
        assert!(is_plain_http_remote("http://example.com/v1"));
        assert!(!is_plain_http_remote("http://localhost:11434/v1"));
        assert!(!is_plain_http_remote("http://127.0.0.1:1234/v1"));
        assert!(!is_plain_http_remote("http://[::1]:1234/v1"));
        assert!(!is_plain_http_remote("https://example.com/v1"));
    }
}
