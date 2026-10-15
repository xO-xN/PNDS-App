//! Tauri command handlers organized by domain.
//!
//! Each submodule contains related commands and their helper functions.
//! Import specific commands via their submodule (e.g. `commands::preferences::load_preferences`).

pub mod assistant_history;
pub mod bundle;
pub mod controlled_checks;
pub mod creation;
pub mod dns;
pub mod help;
pub mod https;
pub mod model;
pub mod notifications;
pub mod preferences;
pub mod project;
pub mod system;
pub mod tools;
