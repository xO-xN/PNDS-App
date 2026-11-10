//! Opt-in own-window paint evidence, never exposed to project pages or IPC.
use super::*;
use std::{ffi::c_void, path::Path};

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGWindowListCreateImage(
        rect: NSRect,
        options: u32,
        window: u32,
        image_options: u32,
    ) -> *const c_void;
    fn CGImageRelease(image: *const c_void);
}

pub(super) unsafe fn capture(
    window: &NSWindow,
    parent: &NSView,
    host: NSRect,
    path: &Path,
    points: &[(f64, f64)],
) -> Result<Value, String> {
    // Only the fixture's own exact window ID is captured. On the minimum
    // supported macOS this API permits own-window capture without recording
    // another application or requesting screen-recording authorization.
    let image = unsafe {
        CGWindowListCreateImage(
            NSRect::new(
                NSPoint::new(f64::INFINITY, f64::INFINITY),
                NSSize::new(0.0, 0.0),
            ),
            8,
            window.windowNumber() as u32,
            1,
        )
    };
    if image.is_null() {
        return Err("Own-window paint capture unavailable".into());
    }
    let class = AnyClass::get(c"NSBitmapImageRep").ok_or("Bitmap capture unavailable")?;
    let bitmap: Retained<AnyObject> = unsafe {
        let allocated: objc2::rc::Allocated<AnyObject> = msg_send![class, alloc];
        msg_send![allocated, initWithCGImage: image]
    };
    unsafe { CGImageRelease(image) };
    let properties: Retained<AnyObject> = unsafe {
        msg_send![
            AnyClass::get(c"NSDictionary").ok_or("Capture properties unavailable")?,
            new
        ]
    };
    let data: Retained<AnyObject> =
        unsafe { msg_send![&*bitmap, representationUsingType: 4_usize, properties: &*properties] };
    let written: Bool = unsafe {
        msg_send![&*data, writeToFile: &*NSString::from_str(&path.to_string_lossy()), atomically: Bool::YES]
    };
    if !written.as_bool() {
        return Err("Could not write own-window paint evidence".into());
    }
    let width: isize = unsafe { msg_send![&*bitmap, pixelsWide] };
    let height: isize = unsafe { msg_send![&*bitmap, pixelsHigh] };
    let frame = window.frame();
    let color_space: Retained<AnyObject> = unsafe {
        msg_send![
            AnyClass::get(c"NSColorSpace").ok_or("Capture color space unavailable")?,
            sRGBColorSpace
        ]
    };
    let samples: Vec<_> = points
        .iter()
        .map(|&(x, y)| unsafe {
            let point = NSPoint::new(
                host.origin.x + x,
                host.origin.y
                    + if parent.isFlipped() {
                        y
                    } else {
                        host.size.height - y
                    },
            );
            let point: NSPoint =
                msg_send![parent, convertPoint: point, toView: std::ptr::null::<NSView>()];
            let pixel_x = (point.x / frame.size.width * width as f64).round() as isize;
            let pixel_y = ((frame.size.height - point.y) / frame.size.height * height as f64)
                .round() as isize;
            let color: Retained<AnyObject> = msg_send![&*bitmap, colorAtX: pixel_x, y: pixel_y];
            let color: Retained<AnyObject> =
                msg_send![&*color, colorUsingColorSpace: &*color_space];
            let red: f64 = msg_send![&*color, redComponent];
            let green: f64 = msg_send![&*color, greenComponent];
            let blue: f64 = msg_send![&*color, blueComponent];
            json!({"point":[x,y],"pixel":[pixel_x,pixel_y],"rgb":[red,green,blue]})
        })
        .collect();
    Ok(json!({"path":path,"size":[width,height],"samples":samples}))
}
