//! A disposable virtual Core MIDI source uses the same OS callback as a device.
use super::*;

#[link(name = "CoreMIDI", kind = "framework")]
extern "C" {
    fn MIDISourceCreateWithProtocol(
        client: u32,
        name: &CFString,
        protocol: i32,
        source: &mut u32,
    ) -> i32;
    fn MIDIEndpointDispose(source: u32) -> i32;
    fn pnds_midi_send(source: u32, status: u8, channel: u8, number: u8, value: u8) -> i32;
}

pub(crate) struct VirtualMidiSource {
    client: u32,
    endpoint: u32,
}

impl VirtualMidiSource {
    pub(crate) fn new(name: &str) -> Result<Self, String> {
        let mut source = Self {
            client: 0,
            endpoint: 0,
        };
        let name = CFString::from_str(name);
        check(
            unsafe { MIDIClientCreateWithBlock(&name, &mut source.client, None) },
            "create fixture client",
        )?;
        check(
            unsafe {
                MIDISourceCreateWithProtocol(source.client, &name, MIDI_1_0, &mut source.endpoint)
            },
            "create fixture source",
        )?;
        Ok(source)
    }

    pub(crate) fn id(&self) -> i32 {
        endpoint_id(self.endpoint).expect("Core MIDI virtual source unique ID")
    }

    pub(crate) fn send(&self, status: u8, channel: u8, number: u8, value: u8) {
        assert!((1..=16).contains(&channel));
        check(
            unsafe { pnds_midi_send(self.endpoint, status, channel - 1, number, value) },
            "send fixture MIDI event",
        )
        .unwrap();
    }
}

impl Drop for VirtualMidiSource {
    fn drop(&mut self) {
        unsafe {
            if self.endpoint != 0 {
                MIDIEndpointDispose(self.endpoint);
            }
            if self.client != 0 {
                MIDIClientDispose(self.client);
            }
        }
    }
}
