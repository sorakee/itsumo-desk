//! Secrets in Windows Credential Manager, as generic credentials named `itsumo-desk:<name>`.

use std::{collections::HashMap, sync::Arc};

use keyring_core::{api::CredentialStoreApi, Entry, Error};
use windows_native_keyring_store::Store;

use crate::platform::{PlatformError, SecretStore};

const SERVICE: &str = "itsumo-desk";

pub struct CredentialManager {
    store: Arc<Store>,
}

impl CredentialManager {
    pub fn new() -> Result<Self, PlatformError> {
        Ok(Self {
            store: Store::new().map_err(os)?,
        })
    }

    fn entry(&self, name: &str) -> Result<Entry, PlatformError> {
        let target = format!("{SERVICE}:{name}");
        // `Local` keeps the key on this machine instead of roaming with a domain profile.
        let modifiers = HashMap::from([("target", target.as_str()), ("persistence", "Local")]);
        self.store
            .build(SERVICE, name, Some(&modifiers))
            .map_err(os)
    }
}

impl SecretStore for CredentialManager {
    fn get(&self, name: &str) -> Result<Option<String>, PlatformError> {
        match self.entry(name)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(Error::NoEntry) => Ok(None),
            Err(error) => Err(os(error)),
        }
    }

    fn set(&self, name: &str, secret: &str) -> Result<(), PlatformError> {
        self.entry(name)?.set_password(secret).map_err(os)
    }

    fn delete(&self, name: &str) -> Result<(), PlatformError> {
        match self.entry(name)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(error) => Err(os(error)),
        }
    }
}

/// keyring-core's messages describe the failure, never the secret bytes.
fn os(error: Error) -> PlatformError {
    PlatformError::Os(error.to_string())
}
