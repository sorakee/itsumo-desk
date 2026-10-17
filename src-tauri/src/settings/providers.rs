//! Provider profiles and which roles use them (D56, D61). API keys are not here; they live in
//! the OS credential store (`keychain.rs`).

use std::collections::HashSet;

use serde::{Deserialize, Deserializer, Serialize};
use specta::Type;

/// Where a profile started from. It fills the base URL at creation; after that the profile's
/// own fields are what count.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum Preset {
    OpenAi,
    DeepSeek,
    OpenRouter,
    Ollama,
    LmStudio,
    #[default]
    Custom,
}

/// By hand rather than `#[serde(other)]`, which specta cannot export: a preset this version
/// does not know reads as `Custom`, so a newer `config.json` still loads.
impl<'de> Deserialize<'de> for Preset {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Ok(match String::deserialize(deserializer)?.as_str() {
            "openai" => Self::OpenAi,
            "deepseek" => Self::DeepSeek,
            "openrouter" => Self::OpenRouter,
            "ollama" => Self::Ollama,
            "lmstudio" => Self::LmStudio,
            _ => Self::Custom,
        })
    }
}

/// What the model behind a profile supports, as the user declares it. Local servers vary.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(default)]
pub struct Capabilities {
    pub tools: bool,
    pub vision: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ProviderProfile {
    /// Never changes, so the credential name and role lists stay valid across renames.
    pub id: String,
    pub name: String,
    pub preset: Preset,
    /// Without a trailing slash; `/chat/completions` is appended.
    pub base_url: String,
    pub model: String,
    pub capabilities: Capabilities,
}

/// Each role is an ordered list of profile ids, tried in turn (the fallback chain, slice 5).
/// An empty `background` or `translate` falls back to `main`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Roles {
    pub main: Vec<String>,
    pub background: Vec<String>,
    pub translate: Vec<String>,
}

impl Roles {
    fn lists_mut(&mut self) -> [&mut Vec<String>; 3] {
        [&mut self.main, &mut self.background, &mut self.translate]
    }

    /// Takes a removed profile out of every role.
    pub fn remove(&mut self, id: &str) {
        for list in self.lists_mut() {
            list.retain(|entry| entry != id);
        }
    }
}

/// Drops profiles with an invalid or repeated id, and role entries naming no profile.
pub(super) fn sanitize(profiles: &mut Vec<ProviderProfile>, roles: &mut Roles) {
    let mut seen = HashSet::new();
    profiles.retain(|profile| {
        crate::character::is_valid_id(&profile.id) && seen.insert(profile.id.clone())
    });
    for profile in profiles.iter_mut() {
        if !matches!(crate::character::display_name(&profile.name), Ok(Some(_))) {
            profile.name = profile.id.clone();
        }
    }
    for list in roles.lists_mut() {
        let mut listed = HashSet::new();
        list.retain(|id| seen.contains(id) && listed.insert(id.clone()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(id: &str) -> ProviderProfile {
        ProviderProfile {
            id: id.into(),
            name: id.to_uppercase(),
            ..ProviderProfile::default()
        }
    }

    #[test]
    fn invalid_profiles_and_dangling_roles_are_dropped() {
        let mut profiles = vec![profile("a"), profile("Bad Id"), profile("a"), profile("b")];
        profiles[3].name = "two\nlines".into();
        let mut roles = Roles {
            main: vec!["b".into(), "gone".into(), "a".into(), "b".into()],
            background: vec!["Bad Id".into()],
            translate: vec![],
        };
        sanitize(&mut profiles, &mut roles);
        let ids: Vec<_> = profiles.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
        assert_eq!(profiles[1].name, "b");
        assert_eq!(roles.main, ["b", "a"]);
        assert!(roles.background.is_empty());
    }

    #[test]
    fn unknown_presets_read_as_custom() {
        let parsed: ProviderProfile =
            serde_json::from_str(r#"{"id":"x","preset":"from-the-future"}"#).expect("parse");
        assert_eq!(parsed.preset, Preset::Custom);
        for preset in [
            Preset::OpenAi,
            Preset::DeepSeek,
            Preset::OpenRouter,
            Preset::Ollama,
            Preset::LmStudio,
            Preset::Custom,
        ] {
            let json = serde_json::to_string(&preset).expect("serialise");
            assert_eq!(
                serde_json::from_str::<Preset>(&json).expect("parse"),
                preset
            );
        }
    }

    #[test]
    fn removing_a_profile_clears_it_from_every_role() {
        let mut roles = Roles {
            main: vec!["a".into(), "b".into()],
            background: vec!["a".into()],
            translate: vec!["a".into()],
        };
        roles.remove("a");
        assert_eq!(roles.main, ["b"]);
        assert!(roles.background.is_empty() && roles.translate.is_empty());
    }
}
