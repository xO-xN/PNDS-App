//! Optional creation monitor for the first one or two project buses.
//!
//! The App-owned synths are read-only and allocate their FFT buffers locally
//! in scsynth. This receiver only publishes complete, matching FFT frames.

use super::{
    bundled_synthdef_path, OscClient, MASTER_GROUP_ID, MASTER_NODE_BASE, MAX_MASTER_INSTANCES,
};
use rosc::{OscBundle, OscMessage, OscPacket, OscTime, OscType};
use std::io::ErrorKind;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

pub(crate) const FFT_SIZE: u32 = 8192;
const BIN_COUNT: usize = FFT_SIZE as usize / 2;
const CHUNK_SIZE: usize = 512;
const CHUNK_COUNT: usize = BIN_COUNT / CHUNK_SIZE;
const ALL_CHUNKS: u8 = u8::MAX;
const MAX_CHANNELS: u32 = 2;
const FIRST_NODE: i32 = MASTER_NODE_BASE + MAX_MASTER_INSTANCES as i32;
const NODE_PAIR_COUNT: u64 = ((i32::MAX as i64 - FIRST_NODE as i64 + 1) / 2) as u64;
const REPLY_TIMEOUT: Duration = Duration::from_millis(500);
const REPLY_ADDRESS: &str = "/pnds/spectrum";

pub(in crate::project) struct SpectrumAnalyzer {
    client: Arc<OscClient>,
    cancelled: Arc<AtomicBool>,
    serial: u64,
    first_node: i32,
    channels: u32,
    started: bool,
}

impl SpectrumAnalyzer {
    pub(crate) fn prepare(port: u16, serial: u64, channels: u32) -> Result<Self, String> {
        let path = bundled_synthdef_path("pndsSpectrum.scsyndef")?;
        let client = Arc::new(OscClient::connect(&format!("127.0.0.1:{port}"))?);
        client
            .socket
            .set_write_timeout(Some(Duration::from_millis(20)))
            .map_err(|error| format!("Could not configure spectrum OSC socket: {error}"))?;
        client.send(OscMessage {
            addr: "/d_load".into(),
            args: vec![OscType::String(path.to_string_lossy().into_owned())],
        })?;
        wait_for_done(&client, "/d_load")?;
        client.send(notify(1))?;
        let analyzer = Self {
            client,
            cancelled: Arc::new(AtomicBool::new(false)),
            serial,
            first_node: FIRST_NODE + ((serial % NODE_PAIR_COUNT) * 2) as i32,
            channels: channels.min(MAX_CHANNELS),
            started: false,
        };
        wait_for_done(&analyzer.client, "/notify")?;
        Ok(analyzer)
    }

    pub(crate) fn serial(&self) -> u64 {
        self.serial
    }

    pub(crate) fn start(
        &mut self,
        private_bus: u32,
        on_frame: impl FnMut(Vec<f32>) + Send + 'static,
    ) -> Result<(), String> {
        let first_node = self.first_node;
        let channel_count = self.channels;
        // Read the completed project buses immediately before the master
        // group. Both channels start on the same audio block.
        let content = (0..channel_count)
            .map(|channel| {
                OscPacket::Message(OscMessage {
                    addr: "/s_new".into(),
                    args: vec![
                        OscType::String("pndsSpectrum".into()),
                        OscType::Int(first_node + channel as i32),
                        OscType::Int(2),
                        OscType::Int(MASTER_GROUP_ID),
                        OscType::String("in".into()),
                        OscType::Int((private_bus + channel) as i32),
                    ],
                })
            })
            .collect();
        self.started = true;
        self.client.send_packet(OscPacket::Bundle(OscBundle {
            timetag: OscTime {
                seconds: 0,
                fractional: 1,
            },
            content,
        }))?;
        let client = Arc::clone(&self.client);
        let cancelled = Arc::clone(&self.cancelled);
        std::thread::Builder::new()
            .name("pnds-spectrum".into())
            .spawn(move || receive(&client, &cancelled, first_node, channel_count, on_frame))
            .map_err(|error| format!("Could not start spectrum receiver: {error}"))?;
        Ok(())
    }
}

impl Drop for SpectrumAnalyzer {
    fn drop(&mut self) {
        self.cancelled.store(true, Ordering::Release);
        if self.started {
            let _ = self.client.send(OscMessage {
                addr: "/n_free".into(),
                args: (0..self.channels)
                    .map(|channel| OscType::Int(self.first_node + channel as i32))
                    .collect(),
            });
        }
        let _ = self.client.send(notify(0));
    }
}

fn notify(enabled: i32) -> OscMessage {
    OscMessage {
        addr: "/notify".into(),
        args: vec![OscType::Int(enabled)],
    }
}

fn wait_for_done(client: &OscClient, command: &str) -> Result<(), String> {
    let reply = client.wait_for_msg("/done", REPLY_TIMEOUT)?;
    match reply.args.first() {
        Some(OscType::String(name)) if name == command => Ok(()),
        _ => Err(format!("scsynth did not acknowledge {command}")),
    }
}

fn receive(
    client: &OscClient,
    cancelled: &AtomicBool,
    first_node: i32,
    channels: u32,
    mut on_frame: impl FnMut(Vec<f32>),
) {
    let mut buffer = [0; 4096];
    let mut frame = Frame::new();
    while !cancelled.load(Ordering::Acquire) {
        let size = match client.socket.recv(&mut buffer) {
            Ok(size) => size,
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                continue;
            }
            Err(error) => {
                if !cancelled.load(Ordering::Acquire) {
                    log::debug!("Spectrum receiver ended: {error}");
                }
                return;
            }
        };
        let packet = &buffer[..size];
        // /notify also carries the project's routine node notifications.
        if !packet.starts_with(b"/pnds/spectrum\0") {
            continue;
        }
        if let Ok(([], OscPacket::Message(message))) = rosc::decoder::decode_udp(packet) {
            if let Some(magnitudes) = frame.accept(message, first_node, channels) {
                on_frame(magnitudes);
            }
        }
    }
}

struct Frame {
    sequence: u32,
    received: [u8; MAX_CHANNELS as usize],
    magnitudes: Vec<f32>,
}

impl Frame {
    fn new() -> Self {
        Self {
            sequence: 0,
            received: [0; MAX_CHANNELS as usize],
            magnitudes: vec![0.0; BIN_COUNT],
        }
    }

    fn accept(&mut self, message: OscMessage, first_node: i32, channels: u32) -> Option<Vec<f32>> {
        use OscType::{Float, Int};
        if message.addr != REPLY_ADDRESS {
            return None;
        }
        let [Int(node), Int(0), Float(sequence), Float(chunk), bins @ ..] = message.args.as_slice()
        else {
            return None;
        };
        let channel = node.checked_sub(first_node)? as usize;
        if channel >= channels as usize
            || !sequence.is_finite()
            || *sequence < 1.0
            || sequence.fract() != 0.0
            || !(0.0..CHUNK_COUNT as f32).contains(chunk)
            || chunk.fract() != 0.0
            || bins.len() != CHUNK_SIZE
            || bins
                .iter()
                .any(|bin| !matches!(bin, Float(value) if value.is_finite() && *value >= 0.0))
        {
            return None;
        }
        let sequence = *sequence as u32;
        if sequence < self.sequence {
            return None;
        }
        if sequence > self.sequence {
            self.sequence = sequence;
            self.received.fill(0);
            self.magnitudes.fill(0.0);
        }
        let chunk = *chunk as usize;
        let mask = 1 << chunk;
        if self.received[channel] & mask != 0 {
            return None;
        }
        self.received[channel] |= mask;
        let start = chunk * CHUNK_SIZE;
        for (target, value) in self.magnitudes[start..start + CHUNK_SIZE]
            .iter_mut()
            .zip(bins)
        {
            if let Float(value) = value {
                *target = target.max(*value);
            }
        }
        self.received[..channels as usize]
            .iter()
            .all(|received| *received == ALL_CHUNKS)
            .then(|| std::mem::replace(&mut self.magnitudes, vec![0.0; BIN_COUNT]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(node: i32, sequence: f32, index: usize, value: f32) -> OscMessage {
        let mut args = vec![
            OscType::Int(node),
            OscType::Int(0),
            OscType::Float(sequence),
            OscType::Float(index as f32),
        ];
        args.extend(std::iter::repeat_n(OscType::Float(value), CHUNK_SIZE));
        OscMessage {
            addr: REPLY_ADDRESS.into(),
            args,
        }
    }

    #[test]
    fn combines_matching_stereo_chunks_by_max_once() {
        let mut frame = Frame::new();
        for index in 0..CHUNK_COUNT {
            assert!(frame
                .accept(chunk(FIRST_NODE, 1.0, index, 0.25), FIRST_NODE, 2)
                .is_none());
        }
        for index in (1..CHUNK_COUNT).rev() {
            assert!(frame
                .accept(chunk(FIRST_NODE + 1, 1.0, index, 0.5), FIRST_NODE, 2)
                .is_none());
        }
        let magnitudes = frame
            .accept(chunk(FIRST_NODE + 1, 1.0, 0, 0.125), FIRST_NODE, 2)
            .unwrap();
        assert_eq!(magnitudes.len(), BIN_COUNT);
        assert!(magnitudes[..CHUNK_SIZE].iter().all(|bin| *bin == 0.25));
        assert!(magnitudes[CHUNK_SIZE..].iter().all(|bin| *bin == 0.5));
        assert!(frame
            .accept(chunk(FIRST_NODE + 1, 1.0, 0, 0.125), FIRST_NODE, 2)
            .is_none());
    }

    #[test]
    fn drops_stale_malformed_and_other_node_chunks() {
        let mut frame = Frame::new();
        assert!(frame
            .accept(chunk(FIRST_NODE, 2.0, 0, 0.75), FIRST_NODE, 1)
            .is_none());
        for message in [
            chunk(FIRST_NODE, 1.0, 1, 1.0),
            chunk(FIRST_NODE + 1, 3.0, 1, 1.0),
            chunk(FIRST_NODE, 3.0, 1, f32::NAN),
            chunk(FIRST_NODE, 3.0, CHUNK_COUNT, 1.0),
        ] {
            assert!(frame.accept(message, FIRST_NODE, 1).is_none());
        }
        for index in 1..CHUNK_COUNT - 1 {
            assert!(frame
                .accept(chunk(FIRST_NODE, 2.0, index, 0.75), FIRST_NODE, 1)
                .is_none());
        }
        let magnitudes = frame
            .accept(chunk(FIRST_NODE, 2.0, CHUNK_COUNT - 1, 0.75), FIRST_NODE, 1)
            .unwrap();
        assert!(magnitudes.iter().all(|bin| *bin == 0.75));
    }
}
