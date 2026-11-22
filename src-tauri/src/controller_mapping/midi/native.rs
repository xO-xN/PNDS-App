//! Core MIDI leases use unique endpoint IDs for preferences and per-connection
//! tokens for incoming events. A device can return with a new endpoint handle.
use super::Message;
use crate::controller_mapping::{self, ControllerMappings};
use block2::{DynBlock, RcBlock};
use objc2_core_foundation::{CFRetained, CFString};
use std::collections::BTreeMap;
use std::ffi::c_void;
use std::ptr::{self, NonNull};
use tauri::{AppHandle, Manager, Runtime};

const MIDI_1_0: i32 = 1;

type EventList = c_void;
type Receiver = dyn Fn(*const EventList, *mut c_void);
type Notifier = dyn Fn(*const u32);
type Visit = extern "C" fn(*mut c_void, u8, u8, u8, u8);

#[link(name = "CoreMIDI", kind = "framework")]
extern "C" {
    static kMIDIPropertyUniqueID: *const CFString;
    static kMIDIPropertyDisplayName: *const CFString;
    static kMIDIPropertyOffline: *const CFString;

    fn MIDIClientCreateWithBlock(
        name: &CFString,
        client: &mut u32,
        notify: Option<&DynBlock<Notifier>>,
    ) -> i32;
    fn MIDIClientDispose(client: u32) -> i32;
    fn MIDIInputPortCreateWithProtocol(
        client: u32,
        name: &CFString,
        protocol: i32,
        port: &mut u32,
        receive: &DynBlock<Receiver>,
    ) -> i32;
    fn MIDIPortDispose(port: u32) -> i32;
    fn MIDIPortConnectSource(port: u32, source: u32, token: *mut c_void) -> i32;
    fn MIDIPortDisconnectSource(port: u32, source: u32) -> i32;
    fn MIDIGetNumberOfSources() -> usize;
    fn MIDIGetSource(index: usize) -> u32;
    fn MIDIObjectFindByUniqueID(id: i32, object: &mut u32, kind: *mut i32) -> i32;
    fn MIDIObjectGetIntegerProperty(object: u32, property: *const CFString, value: &mut i32)
        -> i32;
    fn MIDIObjectGetStringProperty(
        object: u32,
        property: *const CFString,
        value: &mut *mut CFString,
    ) -> i32;
}

extern "C" {
    fn pnds_midi_visit(list: *const EventList, context: *mut c_void, receive: Visit);
}

fn check(status: i32, operation: &str) -> Result<(), String> {
    if status != 0 {
        return Err(format!("Core MIDI {operation}: {status}"));
    }
    Ok(())
}

#[derive(Debug)]
pub(in crate::controller_mapping) struct Endpoint {
    object: u32,
    pub id: i32,
    pub name: String,
}

fn endpoint_id(object: u32) -> Option<i32> {
    let mut id = 0;
    // The property constants live for the process and the out value is owned here.
    let status = unsafe { MIDIObjectGetIntegerProperty(object, kMIDIPropertyUniqueID, &mut id) };
    (status == 0 && id != 0).then_some(id)
}

fn endpoint_name(object: u32) -> Option<String> {
    let mut raw = ptr::null_mut();
    let status = unsafe { MIDIObjectGetStringProperty(object, kMIDIPropertyDisplayName, &mut raw) };
    if status != 0 {
        return None;
    }
    // Core MIDI transfers ownership of the returned string.
    let name = unsafe { CFRetained::from_raw(NonNull::new(raw)?) }.to_string();
    (!name.is_empty()).then_some(name)
}

pub(in crate::controller_mapping) fn endpoints() -> BTreeMap<i32, Endpoint> {
    let mut endpoints = BTreeMap::new();
    for index in 0..unsafe { MIDIGetNumberOfSources() } {
        let object = unsafe { MIDIGetSource(index) };
        if object == 0 {
            continue;
        }
        let mut offline = 0;
        unsafe { MIDIObjectGetIntegerProperty(object, kMIDIPropertyOffline, &mut offline) };
        if offline != 0 {
            continue;
        }
        if let Some(id) = endpoint_id(object) {
            endpoints.insert(
                id,
                Endpoint {
                    object,
                    id,
                    name: endpoint_name(object).unwrap_or_else(|| id.to_string()),
                },
            );
        }
    }
    endpoints
}

pub(in crate::controller_mapping) fn endpoint_display_name(id: i32) -> Option<String> {
    let mut object = 0;
    let status = unsafe { MIDIObjectFindByUniqueID(id, &mut object, ptr::null_mut()) };
    if status != 0 || object == 0 {
        return None;
    }
    endpoint_name(object)
}

struct Connection {
    endpoint: u32,
    token: usize,
}

pub(in crate::controller_mapping) struct Input {
    client: u32,
    port: u32,
    connections: BTreeMap<i32, Connection>,
    next_token: usize,
}

impl Input {
    fn new<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        extern "C" fn visit<F: FnMut(Message)>(
            context: *mut c_void,
            status: u8,
            channel: u8,
            number: u8,
            value: u8,
        ) {
            // The C visitor calls back synchronously with the same context pointer.
            let receive = unsafe { &mut *context.cast::<F>() };
            receive(Message {
                status,
                channel,
                number,
                value,
            });
        }

        fn for_each_event<F: FnMut(Message)>(list: *const EventList, mut receive: F) {
            if !list.is_null() {
                unsafe { pnds_midi_visit(list, ptr::from_mut(&mut receive).cast(), visit::<F>) };
            }
        }

        let notification_app = app.clone();
        let notify = RcBlock::new(move |notification: *const u32| {
            // MIDINotification begins with a 32-bit message ID. Setup, added,
            // removed and property events can change which sources are eligible.
            if matches!(unsafe { notification.as_ref() }, Some(1..=4)) {
                let app = notification_app.clone();
                tauri::async_runtime::spawn(async move { schedule_refresh(&app) });
            }
        });
        let mut client = 0;
        let name = CFString::from_str("PNDS controller mapping");
        check(
            unsafe { MIDIClientCreateWithBlock(&name, &mut client, Some(&notify)) },
            "create client",
        )?;

        let mut input = Self {
            client,
            port: 0,
            connections: BTreeMap::new(),
            next_token: 0,
        };
        let input_app = app.clone();
        let receiver = RcBlock::new(move |list: *const EventList, context: *mut c_void| {
            let token = context as usize;
            for_each_event(list, |message| {
                controller_mapping::receive_midi(&input_app, token, message);
            });
        });
        check(
            unsafe {
                MIDIInputPortCreateWithProtocol(client, &name, MIDI_1_0, &mut input.port, &receiver)
            },
            "create input port",
        )?;
        Ok(input)
    }

    fn reconcile(
        &mut self,
        enabled: &[i32],
        endpoints: &BTreeMap<i32, Endpoint>,
        required: Option<i32>,
    ) -> Result<(), String> {
        let mut result = Ok(());
        self.connections.retain(|id, connection| {
            let same = endpoints
                .get(id)
                .is_some_and(|source| source.object == connection.endpoint);
            if same && enabled.contains(id) {
                return true;
            }
            let status = unsafe { MIDIPortDisconnectSource(self.port, connection.endpoint) };
            if same && status != 0 && required == Some(*id) {
                result = check(status, "disconnect input source");
                return true;
            }
            false
        });

        for id in enabled {
            if self.connections.contains_key(id) {
                continue;
            }
            let Some(source) = endpoints.get(id) else {
                if required == Some(*id) {
                    result = Err("Core MIDI source is unavailable".into());
                }
                continue;
            };
            self.next_token += 1;
            let token = self.next_token;
            let status =
                unsafe { MIDIPortConnectSource(self.port, source.object, token as *mut _) };
            if status == 0 {
                self.connections.insert(
                    *id,
                    Connection {
                        endpoint: source.object,
                        token,
                    },
                );
            } else if required == Some(*id) {
                result = check(status, "connect input source");
            }
        }
        result
    }
}

impl Drop for Input {
    fn drop(&mut self) {
        unsafe {
            if self.port != 0 {
                MIDIPortDispose(self.port);
            }
            MIDIClientDispose(self.client);
        }
    }
}

pub(in crate::controller_mapping) fn synchronize<R: Runtime>(
    app: &AppHandle<R>,
    enabled: &[i32],
    required: Option<i32>,
) -> Result<(), String> {
    let Some(state) = app.try_state::<ControllerMappings>() else {
        return Ok(());
    };
    let mut owned = state
        .midi_input
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if owned.is_none() && !enabled.is_empty() {
        *owned = Some(Input::new(app)?);
    }
    let Some(input) = owned.as_mut() else {
        return Ok(());
    };
    let endpoints = endpoints();
    // Core MIDI can wait on its callback while disconnecting. Only acquire the
    // message routing lock after Core MIDI has returned.
    let result = input.reconcile(enabled, &endpoints, required);
    state.lock().midi.replace(
        input
            .connections
            .iter()
            .map(|(&id, connection)| (id, connection.token)),
    );
    result
}

pub(in crate::controller_mapping) fn schedule_refresh<R: Runtime>(app: &AppHandle<R>) {
    let main = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(state) = main.try_state::<ControllerMappings>() else {
            return;
        };
        let enabled = state.lock().preferences.midi_ports.clone();
        if let Err(error) = synchronize(&main, &enabled, None) {
            log::warn!("Could not refresh Core MIDI sources: {error}");
        }
    });
}

#[cfg(feature = "native-client-fixture")]
pub(crate) mod fixture;
