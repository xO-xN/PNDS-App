//! Tauri command handlers organized by domain.
//!
//! Each submodule contains related commands and their helper functions.
//! Import specific commands via their submodule (e.g., `commands::preferences::load_preferences`).

pub mod bundle;
pub mod examples;
pub mod notifications;
pub mod preferences;
pub mod project;
pub mod system;
