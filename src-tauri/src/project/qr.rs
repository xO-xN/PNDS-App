//! App-owned QR display and the single shipped Node encoder.
use super::session::{HttpsEntryState, HttpsEntryStatus};
use crate::types::SessionStatus;
use serde::{Deserialize, Serialize};
use specta::Type;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PerformerQr {
    pub url: String,
    /// None while generating; the same button can cancel that request.
    pub data_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Request {
    generation: u64,
    revision: u64,
    pub url: String,
}

#[derive(Default)]
pub(super) struct Display {
    revision: u64,
    requested: Option<Request>,
    cached: Option<(u64, PerformerQr)>,
}

impl Display {
    pub fn hide(&mut self) {
        self.revision = self.revision.wrapping_add(1);
        self.requested = None;
    }

    pub fn reset(&mut self) {
        self.hide();
        self.cached = None;
    }

    pub fn reconcile(&mut self, generation: u64, url: Option<&str>) {
        if self.requested.as_ref().is_some_and(|request| {
            request.generation != generation || Some(request.url.as_str()) != url
        }) {
            self.hide();
        }
    }

    pub fn toggle(&mut self, generation: u64, url: &str) -> Option<Request> {
        if self.requested.is_some() {
            self.hide();
            return None;
        }
        self.revision = self.revision.wrapping_add(1);
        let request = Request {
            generation,
            revision: self.revision,
            url: url.to_string(),
        };
        self.requested = Some(request.clone());
        if self
            .cached
            .as_ref()
            .is_some_and(|(run, image)| *run == generation && image.url == url)
        {
            None
        } else {
            Some(request)
        }
    }

    pub fn finish(
        &mut self,
        request: &Request,
        result: Result<String, String>,
    ) -> Result<(), String> {
        if self.requested.as_ref() != Some(request) {
            return Ok(());
        }
        match result {
            Ok(data_url) => {
                self.cached = Some((
                    request.generation,
                    PerformerQr {
                        url: request.url.clone(),
                        data_url: Some(data_url),
                    },
                ));
                Ok(())
            }
            Err(error) => {
                self.hide();
                Err(error)
            }
        }
    }

    pub fn snapshot(&self) -> Option<PerformerQr> {
        let request = self.requested.as_ref()?;
        Some(
            self.cached
                .as_ref()
                .filter(|(generation, image)| {
                    *generation == request.generation && image.url == request.url
                })
                .map(|(_, image)| image.clone())
                .unwrap_or_else(|| PerformerQr {
                    url: request.url.clone(),
                    data_url: None,
                }),
        )
    }
}

/// Uses only applied runtime facts; a failed HTTPS entry never falls back to HTTP.
pub fn performer_url(
    status: SessionStatus,
    host: Option<&str>,
    port: Option<u16>,
    entry: &HttpsEntryState,
) -> Option<String> {
    if status != SessionStatus::Ready {
        return None;
    }
    match entry.status {
        HttpsEntryStatus::Ready => entry.url.clone(),
        HttpsEntryStatus::Preparing | HttpsEntryStatus::Error => None,
        HttpsEntryStatus::Off => {
            let host = host.filter(|host| !host.is_empty())?;
            let port = port.filter(|port| *port != 0)?;
            Some(format!("http://{host}:{port}/"))
        }
    }
}

pub fn render_for_app<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    url: &str,
) -> Result<String, String> {
    let root = super::shared_libraries::shipped_root(app)?;
    let catalog = super::shared_libraries::LibraryCatalog::load(&root)?;
    let library = catalog
        .libraries
        .iter()
        .find(|library| library.id == "qrcode")
        .ok_or("The App QR encoder is missing from the shared library catalog")?;
    let reference = super::manifest::SharedLibraryReference {
        id: library.id.clone(),
        version: library.version.clone(),
    };
    let resolved = super::shared_libraries::resolve_at(&root, &[reference])?;
    let library = resolved
        .get("qrcode")
        .ok_or("The App QR encoder could not be resolved")?;
    render(
        &super::session::node_binary_path()?,
        Path::new(&library.path),
        url,
    )
}

const ENCODE: &str = r#"
const qr = require(process.argv[1]);
qr.toDataURL(process.argv[2], {
  width: 1024, margin: 4, errorCorrectionLevel: 'M',
  color: { dark: '#000000ff', light: '#ffffffff' }
}, (error, image) => {
  if (error) { process.stderr.write(error.message); process.exitCode = 1; }
  else process.stdout.write(image);
});
"#;
const OUTPUT_LIMIT: usize = 256 * 1024;

fn drain(
    pipe: impl Read + Send + 'static,
    overflow: Arc<AtomicBool>,
) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut pipe = pipe;
        let mut output = Vec::new();
        let mut buffer = [0; 8192];
        loop {
            match pipe.read(&mut buffer) {
                Ok(0) | Err(_) => return output,
                Ok(length) => {
                    let keep = length.min(OUTPUT_LIMIT.saturating_sub(output.len()));
                    output.extend_from_slice(&buffer[..keep]);
                    if keep != length {
                        overflow.store(true, Ordering::Release);
                    }
                }
            }
        }
    })
}

fn render(node: &Path, library: &Path, url: &str) -> Result<String, String> {
    if url.len() > 4096 {
        return Err("The performer address is too long for the QR encoder".into());
    }
    let mut child = Command::new(node)
        .args(["-e", ENCODE])
        .arg(library)
        .arg(url)
        .env_remove("NODE_OPTIONS")
        .env_remove("NODE_PATH")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|error| format!("Could not start the App QR encoder: {error}"))?;
    let overflow = Arc::new(AtomicBool::new(false));
    let stdout = drain(
        child.stdout.take().ok_or("QR output pipe is missing")?,
        overflow.clone(),
    );
    let stderr = drain(
        child.stderr.take().ok_or("QR error pipe is missing")?,
        overflow.clone(),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if overflow.load(Ordering::Acquire) {
            break Err("The App QR encoder exceeded its output limit".to_string());
        }
        if Instant::now() >= deadline {
            break Err("The App QR encoder timed out".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(error) => break Err(format!("Could not wait for the App QR encoder: {error}")),
        }
    };
    // Close inherited pipes as well as the direct child before joining readers.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
    let _ = child.wait();
    let output = stdout.join().map_err(|_| "The QR output reader failed")?;
    let errors = stderr.join().map_err(|_| "The QR error reader failed")?;
    let status = status?;
    if overflow.load(Ordering::Acquire) {
        return Err("The App QR encoder exceeded its output limit".into());
    }
    if !status.success() {
        let detail = String::from_utf8_lossy(&errors);
        return Err(format!(
            "The App QR encoder failed: {}",
            detail.chars().take(512).collect::<String>()
        ));
    }
    let image = String::from_utf8(output).map_err(|_| "The QR image is not valid UTF-8")?;
    if !image.starts_with("data:image/png;base64,") {
        return Err("The App QR encoder returned an invalid image".into());
    }
    Ok(image)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encoder_failure_and_excess_output_are_reported_without_accepting_an_image() {
        let temp = tempfile::tempdir().unwrap();
        let module = temp.path().join("encoder.cjs");
        let node = super::super::session::node_binary_path().unwrap();
        std::fs::write(
            &module,
            "exports.toDataURL = () => { throw Error('broken encoder') }",
        )
        .unwrap();
        assert!(render(&node, &module, "http://stage:6868/")
            .unwrap_err()
            .contains("broken encoder"));
        std::fs::write(
            &module,
            "exports.toDataURL = (_, __, cb) => cb(null, 'x'.repeat(300000))",
        )
        .unwrap();
        assert!(render(&node, &module, "http://stage:6868/")
            .unwrap_err()
            .contains("output limit"));
    }

    #[test]
    fn runtime_address_keeps_https_path_and_query_and_never_downgrades_a_failed_entry() {
        let mut entry = HttpsEntryState {
            status: HttpsEntryStatus::Ready,
            url: Some("https://stage.example:8443/join?piece=one&room=2".into()),
            error: None,
        };
        assert_eq!(
            performer_url(SessionStatus::Ready, Some("192.0.2.1"), Some(6868), &entry),
            entry.url
        );
        entry.status = HttpsEntryStatus::Error;
        assert!(
            performer_url(SessionStatus::Ready, Some("192.0.2.1"), Some(6868), &entry).is_none()
        );
        entry.status = HttpsEntryStatus::Off;
        assert_eq!(
            performer_url(
                SessionStatus::Ready,
                Some("stage.local"),
                Some(6868),
                &entry
            )
            .as_deref(),
            Some("http://stage.local:6868/")
        );
        assert!(performer_url(
            SessionStatus::Starting,
            Some("stage.local"),
            Some(6868),
            &entry
        )
        .is_none());
    }

    #[test]
    fn pending_generation_can_be_hidden_and_a_late_image_cannot_reopen_it() {
        let mut state = Display::default();
        let request = state.toggle(1, "http://stage:6868/").unwrap();
        assert!(state.snapshot().unwrap().data_url.is_none());
        assert!(state.toggle(1, &request.url).is_none());
        state.finish(&request, Ok("old image".into())).unwrap();
        assert!(state.snapshot().is_none());
        let next = state.toggle(1, &request.url).unwrap();
        state.finish(&request, Err("late failure".into())).unwrap();
        state.finish(&next, Ok("new image".into())).unwrap();
        assert_eq!(
            state.snapshot().unwrap().data_url.as_deref(),
            Some("new image")
        );
        state.hide();
        assert!(state.toggle(1, &request.url).is_none());
        assert_eq!(
            state.snapshot().unwrap().data_url.as_deref(),
            Some("new image")
        );
    }

    #[test]
    fn entry_failure_and_new_runs_clear_the_display_without_automatic_reopening() {
        let mut state = Display::default();
        let request = state.toggle(1, "http://stage:6868/").unwrap();
        state.finish(&request, Ok("image".into())).unwrap();
        state.reconcile(1, None);
        state.reconcile(1, Some(&request.url));
        assert!(state.snapshot().is_none());
        state.reset();
        let next = state.toggle(2, &request.url).unwrap();
        state.finish(&request, Ok("stale run".into())).unwrap();
        assert!(state.snapshot().unwrap().data_url.is_none());
        assert!(state.finish(&next, Err("encoder failed".into())).is_err());
        assert!(state.snapshot().is_none());
    }

    #[test]
    fn the_actual_shipped_shared_encoder_generates_a_png_without_project_dependencies() {
        use base64::Engine;
        let root = super::super::shared_libraries::default_root().unwrap();
        let catalog = super::super::shared_libraries::LibraryCatalog::load(&root).unwrap();
        let library = catalog
            .libraries
            .iter()
            .find(|library| library.id == "qrcode")
            .unwrap();
        let resolved = super::super::shared_libraries::resolve_at(
            &root,
            &[super::super::manifest::SharedLibraryReference {
                id: library.id.clone(),
                version: library.version.clone(),
            }],
        )
        .unwrap();
        let image = render(
            &super::super::session::node_binary_path().unwrap(),
            Path::new(&resolved["qrcode"].path),
            "https://stage.example:8443/join?room=one&piece=%E4%B9%90%E8%B0%B1",
        )
        .unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(image.strip_prefix("data:image/png;base64,").unwrap())
            .unwrap();
        assert!(bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(bytes.len() > 1000);
    }
}
