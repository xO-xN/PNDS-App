//! Export a trusted saved file through AppKit's native pasteboard drag session.
#[cfg(target_os = "macos")]
mod macos {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, DefinedClass, MainThreadOnly};
    use objc2_app_kit::{
        NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
        NSDraggingSource, NSEvent, NSWindow, NSWorkspace,
    };
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString, NSURL};
    use std::path::Path;

    struct FileDragOptions {
        private: bool,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "PNDSFileDragSource"]
        #[thread_kind = MainThreadOnly]
        #[ivars = FileDragOptions]
        struct FileDragSource;
        unsafe impl NSObjectProtocol for FileDragSource {}
        unsafe impl NSDraggingSource for FileDragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation(
                &self,
                _session: &NSDraggingSession,
                context: NSDraggingContext,
            ) -> NSDragOperation {
                if self.ivars().private && context == NSDraggingContext::OutsideApplication {
                    NSDragOperation::None
                } else {
                    NSDragOperation::Copy
                }
            }
        }
    );
    thread_local! {
        static SOURCE: Retained<FileDragSource> = source(false);
        static PRIVATE_SOURCE: Retained<FileDragSource> = source(true);
    }

    fn source(private: bool) -> Retained<FileDragSource> {
        let mtm = objc2::MainThreadMarker::new().expect("AppKit main thread");
        let source = FileDragSource::alloc(mtm).set_ivars(FileDragOptions { private });
        unsafe { msg_send![super(source), init] }
    }

    fn drag_url(path: &NSString, reference_token: Option<&str>) -> Retained<NSURL> {
        let payload = reference_token.map(|token| {
            // The WebView grants filesystem scope for dropped paths. The
            // reference URL identifies the gesture, not the private file.
            NSString::from_str(&format!("/dev/null/pnds-assistant-reference-{token}"))
        });
        NSURL::fileURLWithPath(payload.as_deref().unwrap_or(path))
    }

    pub(super) fn start(
        window: &tauri::WebviewWindow,
        path: &Path,
        reference_token: Option<&str>,
    ) -> Result<(), String> {
        let mtm = objc2::MainThreadMarker::new().ok_or("File dragging requires the main thread")?;
        let native = window.ns_window().map_err(|error| error.to_string())?;
        // SAFETY: Tauri owns the live NSWindow; all AppKit access is on its UI thread.
        unsafe {
            let native = &*native.cast::<NSWindow>();
            if NSEvent::pressedMouseButtons() & 1 == 0 {
                return Err("The file drag gesture has ended".into());
            }
            let event = NSApplication::sharedApplication(mtm)
                .currentEvent()
                .ok_or("No file drag event")?;
            let view = native.contentView().ok_or("No file drag view")?;
            let name = NSString::from_str(path.to_str().ok_or("Unsupported file path")?);
            // AppKit bridges a file URL to the legacy filename list read by
            // Wry. Writing that legacy type directly to NSPasteboardItem fails.
            let url = drag_url(&name, reference_token);
            let item = NSDraggingItem::initWithPasteboardWriter(
                NSDraggingItem::alloc(),
                ProtocolObject::from_ref(&*url),
            );
            let location = view.convertPoint_fromView(event.locationInWindow(), None);
            let icon = NSWorkspace::sharedWorkspace().iconForFile(&name);
            item.setDraggingFrame_contents(
                NSRect::new(
                    NSPoint::new(location.x - 16.0, location.y - 16.0),
                    NSSize::new(32.0, 32.0),
                ),
                Some(&icon),
            );
            (if reference_token.is_some() {
                &PRIVATE_SOURCE
            } else {
                &SOURCE
            })
            .with(|source| {
                view.beginDraggingSessionWithItems_event_source(
                    &NSArray::from_slice(&[&*item]),
                    &event,
                    ProtocolObject::from_ref(&**source),
                );
            });
        }
        Ok(())
    }

    #[cfg(test)]
    #[test]
    #[ignore = "requires access to the macOS pasteboard service"]
    fn native_drag_pasteboard_bridges_finder_urls_and_private_references() {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeFileURL};

        let path = "/private/tmp/PNDS saved file.txt";
        let token = "00000000-0000-0000-0000-000000000000";
        let private_path = format!("/dev/null/pnds-assistant-reference-{token}");
        assert!(!Path::new(&private_path).exists());
        let pasteboard = NSPasteboard::pasteboardWithUniqueName();
        #[allow(deprecated)]
        let legacy_type = unsafe { objc2_app_kit::NSFilenamesPboardType };
        let name = NSString::from_str(path);
        for (token, expected) in [(None, path), (Some(token), private_path.as_str())] {
            pasteboard.clearContents();
            let url = drag_url(&name, token);
            assert!(
                pasteboard.writeObjects(&NSArray::from_slice(&[ProtocolObject::from_ref(&*url)]))
            );
            assert_eq!(
                pasteboard.stringForType(unsafe { NSPasteboardTypeFileURL }),
                url.absoluteString()
            );
            let paths = pasteboard.propertyListForType(legacy_type).unwrap();
            let paths = paths.downcast::<NSArray>().unwrap();
            let paths: Vec<_> = paths
                .iter()
                .map(|value| value.downcast::<NSString>().unwrap().to_string())
                .collect();
            assert_eq!(paths, [expected]);
        }
        pasteboard.clearContents();
    }
}

pub fn start(window: &tauri::WebviewWindow, path: &std::path::Path) -> Result<(), String> {
    start_drag(window, path, None)
}

pub fn start_private(
    window: &tauri::WebviewWindow,
    path: &std::path::Path,
    token: &str,
) -> Result<(), String> {
    if token.len() != 36
        || !token
            .bytes()
            .all(|byte| byte == b'-' || byte.is_ascii_hexdigit())
    {
        return Err("Invalid private file drag token".into());
    }
    start_drag(window, path, Some(token))
}

fn start_drag(
    window: &tauri::WebviewWindow,
    path: &std::path::Path,
    reference_token: Option<&str>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::start(window, path, reference_token)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, path, reference_token);
        Err("Native file export is available on macOS".into())
    }
}
