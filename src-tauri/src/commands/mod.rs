//! Tauri command handlers organized by domain.
//!
//! Each submodule contains related commands and their helper functions.
//! Import specific commands via their submodule (e.g. `commands::preferences::load_preferences`).

pub mod assistant_history;
pub mod bundle;
pub(crate) mod check_browser;
pub mod controlled_checks;
pub mod creation;
pub mod dns;
pub mod git_merge;
pub mod github_sync;
pub mod help;
pub mod host_entry;
pub mod https;
pub mod materials;
pub mod merge_assistant;
pub mod merge_runtime;
pub mod model;
pub mod notifications;
pub mod preferences;
pub mod project;
pub mod project_media;
pub mod recording;
pub mod system;
pub mod terminal;
pub mod tools;

pub mod participation;

pub mod controller_mapping;
