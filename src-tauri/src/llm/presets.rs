//! What each preset fills in when a profile is created (D61). Claude joins with the Anthropic
//! adapter (M2 slice 5).

use serde::Serialize;
use specta::Type;

use crate::settings::{Capabilities, Preset};

/// The order the preset picker lists them in.
pub const PRESETS: [Preset; 6] = [
    Preset::OpenAi,
    Preset::DeepSeek,
    Preset::OpenRouter,
    Preset::Ollama,
    Preset::LmStudio,
    Preset::Custom,
];

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub preset: Preset,
    pub label: String,
    /// Empty for `Custom`.
    pub base_url: String,
    /// The model a new profile starts with; empty when there is no sensible default.
    pub model: String,
    /// An example shown in the empty model field.
    pub model_hint: String,
    /// Local servers take no key.
    pub needs_key: bool,
    #[serde(skip)]
    pub capabilities: Capabilities,
}

pub fn info(preset: Preset) -> PresetInfo {
    let cloud = Capabilities {
        tools: true,
        vision: false,
    };
    let (label, base_url, model, model_hint, needs_key, capabilities) = match preset {
        Preset::OpenAi => (
            "OpenAI",
            "https://api.openai.com/v1",
            "",
            "e.g. gpt-4.1-mini",
            true,
            cloud,
        ),
        Preset::DeepSeek => (
            "DeepSeek",
            "https://api.deepseek.com/v1",
            "deepseek-chat",
            "deepseek-chat",
            true,
            cloud,
        ),
        Preset::OpenRouter => (
            "OpenRouter",
            "https://openrouter.ai/api/v1",
            "",
            "e.g. deepseek/deepseek-chat",
            true,
            cloud,
        ),
        Preset::Ollama => (
            "Ollama",
            "http://localhost:11434/v1",
            "",
            "e.g. qwen3:8b",
            false,
            Capabilities::default(),
        ),
        Preset::LmStudio => (
            "LM Studio",
            "http://localhost:1234/v1",
            "",
            "the model's identifier",
            false,
            Capabilities::default(),
        ),
        Preset::Custom => (
            "Custom (OpenAI-compatible)",
            "",
            "",
            "the model's name",
            true,
            Capabilities::default(),
        ),
    };
    PresetInfo {
        preset,
        label: label.into(),
        base_url: base_url.into(),
        model: model.into(),
        model_hint: model_hint.into(),
        needs_key,
        capabilities,
    }
}

/// A short id base for new profiles of this preset.
pub fn id_base(preset: Preset) -> &'static str {
    match preset {
        Preset::OpenAi => "openai",
        Preset::DeepSeek => "deepseek",
        Preset::OpenRouter => "openrouter",
        Preset::Ollama => "ollama",
        Preset::LmStudio => "lmstudio",
        Preset::Custom => "custom",
    }
}
