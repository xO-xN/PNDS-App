//! Export a trusted saved file through AppKit's native pasteboard drag session.
#[cfg(target_os = "macos")]
mod macos {
    use objc2::rc::Retained;
    use objc2::runtime::{NSObject, NSObjectProtocol, ProtocolObject};
    use objc2::{define_class, msg_send, AnyThread, MainThreadOnly};
    use objc2_app_kit::{
        NSApplication, NSDragOperation, NSDraggingContext, NSDraggingItem, NSDraggingSession,
        NSDraggingSource, NSEvent, NSWindow, NSWorkspace,
    };
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSSize, NSString, NSURL};
    use std::path::Path;

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "PNDSFileDragSource"]
        #[thread_kind = MainThreadOnly]
        struct FileDragSource;
        unsafe impl NSObjectProtocol for FileDragSource {}
        unsafe impl NSDraggingSource for FileDragSource {
            #[unsafe(method(draggingSession:sourceOperationMaskForDraggingContext:))]
            fn operation(
                &self,
                _session: &NSDraggingSession,
                _context: NSDraggingContext,
            ) -> NSDragOperation {
                // Exporting never moves or deletes a project-owned saved file.
                NSDragOperation::Copy
            }
        }
    );
    thread_local! {
        static SOURCE: Retained<FileDragSource> = {
            let mtm = objc2::MainThreadMarker::new().expect("AppKit main thread");
            unsafe { msg_send![FileDragSource::alloc(mtm), init] }
        };
    }

    pub(super) fn start(window: &tauri::WebviewWindow, path: &Path) -> Result<(), String> {
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
            let url = NSURL::fileURLWithPath(&name);
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
            SOURCE.with(|source| {
                view.beginDraggingSessionWithItems_event_source(
                    &NSArray::from_slice(&[&*item]),
                    &event,
                    ProtocolObject::from_ref(&**source),
                );
            });
        }
        Ok(())
    }
}

pub fn start(window: &tauri::WebviewWindow, path: &std::path::Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        macos::start(window, path)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, path);
        Err("Native file export is available on macOS".into())
    }
}
