use super::{ControllerAddress, ControllerInput, ControllerOscSettings};
use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use tauri::{AppHandle, Runtime};

pub(super) struct Listener {
    pub(super) generation: u32,
    task: tauri::async_runtime::JoinHandle<()>,
}

impl Listener {
    pub(super) fn start<R: Runtime>(
        app: AppHandle<R>,
        generation: u32,
        address: Ipv4Addr,
        port: u16,
    ) -> Result<Self, String> {
        let socket = UdpSocket::bind((address, port))
            .map_err(|error| format!("Could not receive OSC at {address}:{port}: {error}"))?;
        socket
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let task = tauri::async_runtime::spawn(async move {
            let Ok(socket) = tokio::net::UdpSocket::from_std(socket) else {
                return;
            };
            let mut bytes = [0; 4096];
            while let Ok((size, source)) = socket.recv_from(&mut bytes).await {
                if size < bytes.len() {
                    if let Some(input) = decode(&bytes[..size], source.ip()) {
                        super::receive_osc(&app, address, generation, source.ip(), input);
                    }
                }
            }
        });
        Ok(Self { generation, task })
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub(super) fn listen_addresses(
    settings: &ControllerOscSettings,
) -> Result<BTreeSet<Ipv4Addr>, String> {
    if !settings.enabled {
        return Ok(BTreeSet::new());
    }
    let mut addresses = BTreeSet::from([Ipv4Addr::LOCALHOST]);
    if settings.lan_enabled {
        addresses.extend(
            crate::project::session::list_lan_addresses()?
                .iter()
                .filter_map(|address| address.parse::<Ipv4Addr>().ok()),
        );
    }
    Ok(addresses)
}

pub(super) fn decode(bytes: &[u8], source: IpAddr) -> Option<ControllerInput> {
    if bytes.first() != Some(&b'/') {
        return None;
    }
    let ([], rosc::OscPacket::Message(message)) = rosc::decoder::decode_udp(bytes).ok()? else {
        return None;
    };
    let address = message.addr;
    if address.len() < 2
        || address.len() > 1024
        || address
            .chars()
            .any(|char| char.is_whitespace() || char.is_control())
    {
        return None;
    }
    let value = match message.args.as_slice() {
        [] => None,
        [wire_value] => {
            let value = match wire_value {
                rosc::OscType::Int(value) => f64::from(*value),
                rosc::OscType::Float(value) => f64::from(*value),
                rosc::OscType::Long(value) => *value as f64,
                rosc::OscType::Double(value) => *value,
                _ => return None,
            };
            if !value.is_finite() {
                return None;
            }
            Some(value)
        }
        _ => return None,
    };
    Some(ControllerInput {
        address: ControllerAddress::Osc {
            sender: (!source.is_loopback()).then(|| source.to_string()),
            address,
        },
        value,
        midi_cc: None,
    })
}
