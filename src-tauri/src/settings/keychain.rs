//! Provider API keys, kept in the OS credential store and never in `config.json`. Only the
//! core reads them; nothing here may log, emit or return a key to the webview.

use crate::platform::{PlatformError, SecretStore};

#[derive(Debug, thiserror::Error)]
#[error("the credential store failed: {0}")]
pub struct KeychainError(#[from] PlatformError);

pub struct Keychain {
    store: Box<dyn SecretStore>,
}

impl Keychain {
    pub fn new(store: impl SecretStore) -> Self {
        Self {
            store: Box::new(store),
        }
    }

    fn name(profile_id: &str) -> String {
        format!("provider:{profile_id}")
    }

    /// The profile's key, or `None` when it has none. Blocks on the OS store.
    pub fn provider_key(&self, profile_id: &str) -> Result<Option<String>, KeychainError> {
        Ok(self.store.get(&Self::name(profile_id))?)
    }

    pub fn has_provider_key(&self, profile_id: &str) -> Result<bool, KeychainError> {
        Ok(self.provider_key(profile_id)?.is_some())
    }

    pub fn set_provider_key(&self, profile_id: &str, key: &str) -> Result<(), KeychainError> {
        Ok(self.store.set(&Self::name(profile_id), key)?)
    }

    /// Succeeds when the profile had no key.
    pub fn delete_provider_key(&self, profile_id: &str) -> Result<(), KeychainError> {
        Ok(self.store.delete(&Self::name(profile_id))?)
    }
}

/// An in-memory store for tests.
#[cfg(test)]
#[derive(Default)]
struct MemoryStore(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemoryStore {
    fn get(&self, name: &str) -> Result<Option<String>, PlatformError> {
        Ok(self.0.lock().expect("lock").get(name).cloned())
    }

    fn set(&self, name: &str, secret: &str) -> Result<(), PlatformError> {
        self.0
            .lock()
            .expect("lock")
            .insert(name.into(), secret.into());
        Ok(())
    }

    fn delete(&self, name: &str) -> Result<(), PlatformError> {
        self.0.lock().expect("lock").remove(name);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_kept_per_profile() {
        let keychain = Keychain::new(MemoryStore::default());
        keychain.set_provider_key("a", "sk-a").expect("set");
        assert_eq!(
            keychain.provider_key("a").expect("get").as_deref(),
            Some("sk-a")
        );
        assert!(!keychain.has_provider_key("b").expect("has"));
        keychain.delete_provider_key("a").expect("delete");
        keychain
            .delete_provider_key("a")
            .expect("deleting nothing succeeds");
        assert!(!keychain.has_provider_key("a").expect("has"));
    }
}
