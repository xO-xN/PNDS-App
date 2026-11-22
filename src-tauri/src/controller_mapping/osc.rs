use super::{ControllerAddress, ControllerInput};
use std::net::{IpAddr, Ipv4Addr, UdpSocket};
use tauri::{AppHandle, Runtime};

pub(super) struct Listener(tauri::async_runtime::JoinHandle<()>);

impl Listener {
    pub(super) fn start<R: Runtime>(
        app: AppHandle<R>,
        generation: u32,
        port: u16,
    ) -> Result<Self, String> {
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, port))
            .map_err(|error| format!("Could not bind OSC receive port {port}: {error}"))?;
        socket
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        Ok(Self(tauri::async_runtime::spawn(async move {
            let Ok(socket) = tokio::net::UdpSocket::from_std(socket) else {
                return;
            };
            let mut bytes = [0; 4096];
            while let Ok((size, source)) = socket.recv_from(&mut bytes).await {
                if size < bytes.len() {
                    if let Some(input) = decode(&bytes[..size], source.ip()) {
                        super::receive_osc(&app, generation, input);
                    }
                }
            }
        })))
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub(super) fn decode(bytes: &[u8], source: IpAddr) -> Option<ControllerInput> {
    if !source.is_loopback() || bytes.first() != Some(&b'/') {
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
        || !message.args.is_empty()
    {
        return None;
    }
    Some(ControllerInput {
        address: ControllerAddress::Osc {
            sender: None,
            address,
        },
        value: None,
    })
}
