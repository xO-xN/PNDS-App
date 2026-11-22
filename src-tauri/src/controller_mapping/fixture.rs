//! Hold one real UDP input between native receipt and main-thread delivery.
use super::{ControllerAddress, ControllerMappings};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

pub(super) struct OscCapture {
    address: String,
    captured: oneshot::Sender<DeferredOsc>,
}

pub(crate) struct DeferredOsc {
    pub(crate) page: u32,
    dispatch: Box<dyn FnOnce() + Send>,
}

impl OscCapture {
    pub(super) fn defer(self, page: u32, dispatch: impl FnOnce() + Send + 'static) {
        let _ = self.captured.send(DeferredOsc {
            page,
            dispatch: Box::new(dispatch),
        });
    }
}

impl DeferredOsc {
    pub(crate) async fn resume(self, app: &AppHandle) {
        (self.dispatch)();
        // Wait behind the real dispatch before sending any new test input.
        let (sender, receiver) = oneshot::channel();
        app.run_on_main_thread(move || {
            let _ = sender.send(());
        })
        .unwrap();
        receiver.await.unwrap();
    }
}

pub(crate) fn hold_next_local_osc(
    app: &AppHandle,
    address: &str,
) -> oneshot::Receiver<DeferredOsc> {
    let (captured, observed) = oneshot::channel();
    let controller = app.state::<ControllerMappings>();
    let mut slot = controller.osc_capture.lock().unwrap();
    assert!(slot.is_none(), "one capture may be armed at a time");
    *slot = Some(OscCapture {
        address: address.into(),
        captured,
    });
    observed
}

pub(super) fn take_capture(
    controller: &ControllerMappings,
    address: &ControllerAddress,
) -> Option<OscCapture> {
    let ControllerAddress::Osc {
        sender: None,
        address,
    } = address
    else {
        return None;
    };
    let mut slot = controller.osc_capture.lock().unwrap();
    if slot
        .as_ref()
        .is_some_and(|capture| capture.address == *address)
    {
        return slot.take();
    }
    None
}
