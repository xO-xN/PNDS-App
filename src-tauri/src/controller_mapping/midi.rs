//! MIDI routing keeps a press and its release on the exact source lease.
use super::{ControllerAddress, ControllerInput};
use std::collections::{BTreeMap, BTreeSet};

#[cfg(target_os = "macos")]
pub(super) mod native;

#[derive(Clone, Copy)]
pub(super) struct Message {
    pub status: u8,
    pub channel: u8,
    pub number: u8,
    pub value: u8,
}

#[derive(Default)]
pub(super) struct Routes {
    ports: BTreeMap<i32, Route>,
}

struct Route {
    token: usize,
    pressed: BTreeSet<(u8, u8)>,
    recent: Option<ControllerAddress>,
}

impl Routes {
    pub(super) fn replace(&mut self, ports: impl IntoIterator<Item = (i32, usize)>) {
        let mut previous = std::mem::take(&mut self.ports);
        self.ports = ports
            .into_iter()
            .map(|(port, token)| {
                let route = previous
                    .remove(&port)
                    .filter(|route| route.token == token)
                    .unwrap_or_else(|| Route {
                        token,
                        pressed: BTreeSet::new(),
                        recent: None,
                    });
                (port, route)
            })
            .collect();
    }

    pub(super) fn owns(&self, port: i32, token: usize) -> bool {
        self.ports
            .get(&port)
            .is_some_and(|route| route.token == token)
    }

    pub(super) fn connected(&self, port: i32) -> bool {
        self.ports.contains_key(&port)
    }

    pub(super) fn recent(&self, port: i32) -> Option<ControllerAddress> {
        self.ports.get(&port).and_then(|route| route.recent.clone())
    }

    pub(super) fn receive(&mut self, token: usize, message: Message) -> Option<ControllerInput> {
        if message.channel > 15 || message.number > 127 || message.value > 127 {
            return None;
        }
        let (&port, route) = self
            .ports
            .iter_mut()
            .find(|(_, route)| route.token == token)?;
        let pressed = match message.status {
            0x8 => false,
            0x9 => message.value > 0,
            _ => return None,
        };
        let key = (message.channel, message.number);
        let address = ControllerAddress::MidiNote {
            port,
            channel: message.channel + 1,
            note: message.number,
        };
        route.recent = Some(address.clone());
        if !pressed {
            route.pressed.remove(&key);
            return None;
        }
        route.pressed.insert(key).then_some(ControllerInput {
            address,
            value: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::controller_mapping::ControllerAddress;

    #[test]
    fn enabled_midi_note_presses_are_distinct_across_ports_and_channels() {
        let mut routes = Routes::default();
        routes.replace([(11, 1), (22, 2)]);
        let press = |channel| Message {
            status: 0x9,
            channel,
            number: 60,
            value: 100,
        };
        let is_note = |port, channel| ControllerAddress::MidiNote {
            port,
            channel,
            note: 60,
        };
        assert!(routes.receive(3, press(0)).is_none());
        assert_eq!(routes.receive(1, press(0)).unwrap().address, is_note(11, 1));
        assert!(routes.receive(1, press(0)).is_none());
        assert_eq!(routes.recent(11), Some(is_note(11, 1)));
        assert_eq!(routes.receive(1, press(1)).unwrap().address, is_note(11, 2));
        assert_eq!(routes.receive(2, press(0)).unwrap().address, is_note(22, 1));

        let zero_velocity = Message {
            value: 0,
            ..press(0)
        };
        assert!(routes.receive(1, zero_velocity).is_none());
        assert_eq!(routes.receive(1, press(0)).unwrap().address, is_note(11, 1));
        let release = Message {
            status: 0x8,
            ..press(0)
        };
        assert!(routes.receive(1, release).is_none());

        routes.replace([(11, 4)]);
        assert!(!routes.owns(11, 1));
        assert!(routes.receive(2, press(0)).is_none());
        assert_eq!(routes.recent(11), None);
        assert_eq!(routes.receive(4, press(0)).unwrap().address, is_note(11, 1));
    }
}
