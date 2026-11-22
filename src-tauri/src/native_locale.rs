//! Read the same language catalogs as the App shell for native page copy.
use serde_json::Value;
use std::sync::OnceLock;
use tauri::{AppHandle, Runtime};

pub(crate) fn catalog(language: &str) -> Result<&'static Value, String> {
    static ENGLISH: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    static CHINESE: OnceLock<Result<Value, serde_json::Error>> = OnceLock::new();
    let (cached, source) = if language.starts_with("zh") {
        (&CHINESE, include_str!("../../locales/zh-CN.json"))
    } else {
        (&ENGLISH, include_str!("../../locales/en.json"))
    };
    cached
        .get_or_init(|| serde_json::from_str(source))
        .as_ref()
        .map_err(ToString::to_string)
}

pub(crate) fn active_catalog<R: Runtime>(app: &AppHandle<R>) -> Result<&'static Value, String> {
    let language = crate::commands::preferences::load_preferences_sync(app)?.language;
    if let Some(language) = language.as_deref().filter(|value| *value != "system") {
        return catalog(language);
    }
    let system = objc2_foundation::NSLocale::preferredLanguages()
        .firstObject()
        .map(|language| language.to_string())
        .unwrap_or_else(|| "en".into());
    catalog(&system)
}
