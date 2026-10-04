//! Thin `#[tauri::command]` handlers: validate, delegate, map errors. No business logic.

pub mod app;
pub mod character;
pub mod companion;
mod error;

pub use error::AppError;
