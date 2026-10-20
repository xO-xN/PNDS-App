//! Notification Web API initialization belongs to Host pages, not checked scores.
use tauri::ipc::Invoke;
use tauri::plugin::{Plugin, TauriPlugin};
use tauri::webview::PageLoadPayload;
use tauri::{AppHandle, RunEvent, Runtime, Url, Webview, Window};

struct HostNotifications<R: Runtime>(TauriPlugin<R>);

pub fn init<R: Runtime>() -> impl Plugin<R> {
    HostNotifications(tauri_plugin_notification::init())
}

impl<R: Runtime> Plugin<R> for HostNotifications<R> {
    fn name(&self) -> &'static str {
        self.0.name()
    }
    fn initialize(
        &mut self,
        app: &AppHandle<R>,
        config: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error>> {
        self.0.initialize(app, config)
    }
    fn initialization_script(&self) -> Option<String> {
        self.0.initialization_script().map(|source| format!("if (!window.__TAURI_INTERNALS__.metadata.currentWebview.label.startsWith('check-page-')) {{ {source} }}"))
    }
    fn window_created(&mut self, window: Window<R>) {
        self.0.window_created(window)
    }
    fn webview_created(&mut self, webview: Webview<R>) {
        self.0.webview_created(webview)
    }
    fn on_navigation(&mut self, webview: &Webview<R>, url: &Url) -> bool {
        self.0.on_navigation(webview, url)
    }
    fn on_page_load(&mut self, webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
        self.0.on_page_load(webview, payload)
    }
    fn on_event(&mut self, app: &AppHandle<R>, event: &RunEvent) {
        self.0.on_event(app, event)
    }
    fn extend_api(&mut self, invoke: Invoke<R>) -> bool {
        self.0.extend_api(invoke)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::plugin::Plugin;
    #[test]
    fn checked_project_pages_do_not_invoke_host_notification_bootstrap() {
        let node = crate::project::session::node_binary_path().expect("bundled Node");
        let script = init::<tauri::test::MockRuntime>()
            .initialization_script()
            .unwrap();
        for (label, expected) in [("main", 1), ("check-page-179225", 0)] {
            let label = serde_json::to_string(label).unwrap();
            let source=format!("let calls=0;globalThis.window={{__TAURI_INTERNALS__:{{metadata:{{currentWebview:{{label:{label}}}}},invoke:async()=>{{calls++;return false}}}}}};{script};setImmediate(()=>console.log(calls));");
            let output = std::process::Command::new(&node)
                .args(["-e", &source])
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            assert_eq!(
                String::from_utf8(output.stdout).unwrap().trim(),
                expected.to_string(),
                "notification bootstrap on {label}"
            );
        }
    }
}
