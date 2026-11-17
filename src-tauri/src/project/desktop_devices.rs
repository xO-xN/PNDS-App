//! Read-only metadata for the bottom bar, independent of startup capability checks.
use serde::Serialize;
use specta::Type;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AudioDeviceKind {
    Headphones,
    Speaker,
    Interface,
    Virtual,
    Aggregate,
    #[default]
    Unknown,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NetworkInterfaceKind {
    Wifi,
    Ethernet,
    #[default]
    Unknown,
}

#[derive(Debug, Default, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDeviceStatus {
    pub audio: AudioDeviceKind,
    pub network: NetworkInterfaceKind,
}

pub fn network_interface_kinds(addresses: Vec<String>) -> BTreeMap<String, NetworkInterfaceKind> {
    addresses
        .into_iter()
        .map(|address| {
            #[cfg(target_os = "macos")]
            let kind = macos::network_kind(Some(&address)).unwrap_or_default();
            #[cfg(not(target_os = "macos"))]
            let kind = NetworkInterfaceKind::Unknown;
            (address, kind)
        })
        .collect()
}

pub fn describe(
    output_device: Option<&str>,
    lan_ip: Option<&str>,
    audio_enabled: bool,
) -> DesktopDeviceStatus {
    #[cfg(target_os = "macos")]
    return DesktopDeviceStatus {
        audio: if audio_enabled {
            macos::audio_kind(output_device).unwrap_or_default()
        } else {
            AudioDeviceKind::Unknown
        },
        network: macos::network_kind(lan_ip).unwrap_or_default(),
    };
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (output_device, lan_ip, audio_enabled);
        DesktopDeviceStatus::default()
    }
}

#[cfg(target_os = "macos")]
pub(crate) use macos::{output_uid, output_uid_alive};

#[cfg(target_os = "macos")]
mod macos {
    use super::{AudioDeviceKind, NetworkInterfaceKind};
    use cpal::traits::{DeviceTrait, HostTrait};
    use objc2_core_audio::*;
    use objc2_core_foundation::CFString;
    use std::ffi::c_void;
    use std::ptr::NonNull;
    use system_configuration::network_configuration::{get_interfaces, SCNetworkInterfaceType};

    fn address(selector: u32, scope: u32) -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress {
            mSelector: selector,
            mScope: scope,
            mElement: kAudioObjectPropertyElementMain,
        }
    }

    fn word(
        object: u32,
        mut property: AudioObjectPropertyAddress,
        qualifier: Option<&*const CFString>,
    ) -> Option<u32> {
        let mut value = 0_u32;
        let mut size = 4_u32;
        let qualifier_size = qualifier.map_or(0, |_| std::mem::size_of::<*const CFString>() as u32);
        let qualifier = qualifier.map_or(std::ptr::null(), |value| {
            std::ptr::from_ref(value).cast::<c_void>()
        });
        // All buffers live through the synchronous HAL call; the output is exactly one UInt32.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&mut property),
                qualifier_size,
                qualifier,
                NonNull::from(&mut size),
                NonNull::from(&mut value).cast(),
            )
        };
        (status == 0 && size == 4).then_some(value)
    }

    fn streams(object: u32) -> Option<Vec<u32>> {
        let mut property = address(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput);
        let mut size = 0_u32;
        // The HAL reports the required byte count before we allocate the output buffer.
        let status = unsafe {
            AudioObjectGetPropertyDataSize(
                object,
                NonNull::from(&mut property),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
            )
        };
        if status != 0 || size == 0 || size > 4096 || size % 4 != 0 {
            return None;
        }
        let mut values = vec![0_u32; size as usize / 4];
        let capacity = size;
        // The initialized buffer holds the exact reported size. A concurrent device change
        // may fail this read; it must not be treated as a successful classification.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&mut property),
                0,
                std::ptr::null(),
                NonNull::from(&mut size),
                NonNull::new(values.as_mut_ptr())?.cast(),
            )
        };
        if status != 0 || size > capacity || size % 4 != 0 {
            return None;
        }
        values.truncate(size as usize / 4);
        Some(values)
    }

    pub(crate) fn output_uid(name: Option<&str>) -> Option<String> {
        let host = cpal::default_host();
        let device = if let Some(name) = name {
            let mut matching = host
                .output_devices()
                .ok()?
                .filter(|device| device.to_string() == name);
            let device = matching.next()?;
            // Existing selections use names. Ambiguous names do not justify a type guess.
            if matching.next().is_some() {
                return None;
            }
            device
        } else {
            host.default_output_device()?
        };
        Some(device.id().ok()?.id().to_owned())
    }

    fn output_object(uid: &str) -> Option<u32> {
        let uid = CFString::from_str(uid);
        let uid_ptr: *const CFString = &*uid;
        let object = word(
            kAudioObjectSystemObject as u32,
            address(
                kAudioHardwarePropertyTranslateUIDToDevice,
                kAudioObjectPropertyScopeGlobal,
            ),
            Some(&uid_ptr),
        )?;
        (object != kAudioObjectUnknown).then_some(object)
    }

    pub(crate) fn output_uid_alive(uid: &str) -> bool {
        output_object(uid).is_some_and(|object| {
            word(
                object,
                address(
                    kAudioDevicePropertyDeviceIsAlive,
                    kAudioObjectPropertyScopeGlobal,
                ),
                None,
            ) == Some(1)
        })
    }

    pub(super) fn audio_kind(name: Option<&str>) -> Option<AudioDeviceKind> {
        let object = output_object(&output_uid(name)?)?;
        let transport = word(
            object,
            address(
                kAudioDevicePropertyTransportType,
                kAudioObjectPropertyScopeGlobal,
            ),
            None,
        );
        let terminals = streams(object)
            .unwrap_or_default()
            .into_iter()
            .map(|stream| {
                word(
                    stream,
                    address(
                        kAudioStreamPropertyTerminalType,
                        kAudioObjectPropertyScopeGlobal,
                    ),
                    None,
                )
            });
        Some(classify_audio(transport, terminals))
    }

    #[allow(non_upper_case_globals)] // Public Apple SDK constant names in patterns.
    fn classify_audio(
        transport: Option<u32>,
        terminals: impl IntoIterator<Item = Option<u32>>,
    ) -> AudioDeviceKind {
        match transport {
            Some(kAudioDeviceTransportTypeAggregate) => return AudioDeviceKind::Aggregate,
            Some(kAudioDeviceTransportTypeVirtual) => return AudioDeviceKind::Virtual,
            _ => {}
        }
        let mut found = None;
        for terminal in terminals {
            let kind = match terminal {
                // IOAudioTypes.h still defines the numeric USB terminal codes
                // returned by macOS drivers alongside CoreAudio's FourCC values.
                Some(kAudioStreamTerminalTypeHeadphones | 0x0302 | 0x0402) => {
                    AudioDeviceKind::Headphones
                }
                Some(
                    kAudioStreamTerminalTypeSpeaker
                    | kAudioStreamTerminalTypeLFESpeaker
                    | kAudioStreamTerminalTypeReceiverSpeaker
                    | 0x0301
                    | 0x0304
                    | 0x0305
                    | 0x0306
                    | 0x0307,
                ) => AudioDeviceKind::Speaker,
                // Some physical interfaces (including PCI-backed Thunderbolt
                // devices) report an unspecified terminal rather than a speaker.
                Some(0) if transport.is_some() => AudioDeviceKind::Speaker,
                Some(
                    kAudioStreamTerminalTypeLine
                    | kAudioStreamTerminalTypeDigitalAudioInterface
                    | kAudioStreamTerminalTypeHDMI
                    | kAudioStreamTerminalTypeDisplayPort,
                ) => AudioDeviceKind::Interface,
                _ => return AudioDeviceKind::Unknown,
            };
            if found.is_some_and(|previous| previous != kind) {
                return AudioDeviceKind::Unknown;
            }
            found = Some(kind);
        }
        found.unwrap_or(match transport {
            Some(
                kAudioDeviceTransportTypeUSB
                | kAudioDeviceTransportTypeThunderbolt
                | kAudioDeviceTransportTypeFireWire,
            ) => AudioDeviceKind::Interface,
            _ => AudioDeviceKind::Unknown,
        })
    }

    pub(super) fn network_kind(ip: Option<&str>) -> Option<NetworkInterfaceKind> {
        let ip: std::net::Ipv4Addr = ip?.parse().ok()?;
        if ip.is_loopback() || ip.is_unspecified() {
            return None;
        }
        let name = interface_for_ip(ip, if_addrs::get_if_addrs().ok()?)?;
        get_interfaces().iter().find_map(|candidate| {
            (candidate.bsd_name()? == name).then(|| match candidate.interface_type() {
                Some(SCNetworkInterfaceType::IEEE80211) => NetworkInterfaceKind::Wifi,
                Some(SCNetworkInterfaceType::Ethernet) => NetworkInterfaceKind::Ethernet,
                _ => NetworkInterfaceKind::Unknown,
            })
        })
    }

    fn interface_for_ip(
        ip: std::net::Ipv4Addr,
        interfaces: Vec<if_addrs::Interface>,
    ) -> Option<String> {
        let mut matches = interfaces.into_iter().filter(
            |interface| matches!(interface.addr, if_addrs::IfAddr::V4(ref v4) if v4.ip == ip),
        );
        let interface = matches.next()?;
        if matches.next().is_some() {
            return None;
        }
        Some(interface.name)
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::project::desktop_devices::describe;

        #[test]
        fn recognizes_driver_ioaudio_terminal_codes_and_untyped_sound_cards() {
            // IOAudioTypes.h: OUTPUT_HEADPHONES, BIDIRECTIONAL_HEADSET, OUTPUT_SPEAKER.
            assert_eq!(
                classify_audio(Some(kAudioDeviceTransportTypeBuiltIn), [Some(0x0302)]),
                AudioDeviceKind::Headphones
            );
            assert_eq!(
                classify_audio(Some(kAudioDeviceTransportTypeBluetooth), [Some(0x0402)]),
                AudioDeviceKind::Headphones
            );
            assert_eq!(
                classify_audio(Some(kAudioDeviceTransportTypeBuiltIn), [Some(0x0301)]),
                AudioDeviceKind::Speaker
            );
            // Captured from Universal Audio's PCI-backed Thunderbolt output stream.
            assert_eq!(
                classify_audio(Some(kAudioDeviceTransportTypePCI), [Some(0)]),
                AudioDeviceKind::Speaker
            );
        }

        #[test]
        fn menu_metadata_does_not_guess_for_invalid_or_loopback_addresses() {
            let kinds = crate::project::desktop_devices::network_interface_kinds(vec![
                "invalid".into(),
                "127.0.0.1".into(),
                "::1".into(),
                "0.0.0.0".into(),
            ]);
            assert_eq!(kinds.len(), 4);
            assert!(kinds
                .values()
                .all(|kind| *kind == NetworkInterfaceKind::Unknown));
        }

        #[test]
        fn classifies_only_explicit_terminal_facts() {
            assert_eq!(
                classify_audio(
                    Some(kAudioDeviceTransportTypeBluetooth),
                    [Some(kAudioStreamTerminalTypeHeadphones)]
                ),
                AudioDeviceKind::Headphones
            );
            assert_eq!(
                classify_audio(None, [Some(kAudioStreamTerminalTypeSpeaker)]),
                AudioDeviceKind::Speaker
            );
            assert_eq!(classify_audio(None, [None]), AudioDeviceKind::Unknown);
            assert_eq!(
                classify_audio(
                    None,
                    [
                        Some(kAudioStreamTerminalTypeHeadphones),
                        Some(kAudioStreamTerminalTypeSpeaker)
                    ]
                ),
                AudioDeviceKind::Unknown
            );
            assert_eq!(
                classify_audio(Some(kAudioDeviceTransportTypeBluetooth), []),
                AudioDeviceKind::Unknown
            );
        }

        #[test]
        fn preserves_virtual_aggregate_and_interface_outputs() {
            assert_eq!(
                classify_audio(
                    Some(kAudioDeviceTransportTypeVirtual),
                    [Some(kAudioStreamTerminalTypeSpeaker)]
                ),
                AudioDeviceKind::Virtual
            );
            assert_eq!(
                classify_audio(
                    Some(kAudioDeviceTransportTypeAggregate),
                    [Some(kAudioStreamTerminalTypeHeadphones)]
                ),
                AudioDeviceKind::Aggregate
            );
            assert_eq!(
                classify_audio(Some(kAudioDeviceTransportTypeUSB), []),
                AudioDeviceKind::Interface
            );
        }

        #[test]
        fn absent_network_is_unknown_and_disabled_audio_is_not_resolved() {
            let status = describe(None, None, false);
            assert_eq!(status.audio, AudioDeviceKind::Unknown);
            assert_eq!(status.network, NetworkInterfaceKind::Unknown);
        }

        #[test]
        fn matches_the_selected_lan_instead_of_the_first_interface() {
            fn interface(name: &str, ip: [u8; 4]) -> if_addrs::Interface {
                if_addrs::Interface {
                    name: name.to_owned(),
                    addr: if_addrs::IfAddr::V4(if_addrs::Ifv4Addr {
                        ip: ip.into(),
                        netmask: [255, 255, 255, 0].into(),
                        prefixlen: 24,
                        broadcast: None,
                    }),
                    index: None,
                }
            }
            let interfaces = vec![
                interface("wifi", [192, 168, 1, 2]),
                interface("ethernet", [192, 168, 2, 2]),
            ];
            assert_eq!(
                interface_for_ip([192, 168, 2, 2].into(), interfaces.clone()).as_deref(),
                Some("ethernet")
            );
            assert_eq!(
                interface_for_ip([192, 168, 3, 2].into(), interfaces.clone()),
                None
            );
            let mut duplicate = interfaces.clone();
            duplicate.push(interface("ambiguous", [192, 168, 2, 2]));
            assert_eq!(interface_for_ip([192, 168, 2, 2].into(), duplicate), None);
        }
    }
}
