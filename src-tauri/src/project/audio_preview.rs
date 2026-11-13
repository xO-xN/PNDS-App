//! Native playback of a checked, private, seekable audio copy.
use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AudioPreviewError {
    SourceUnavailable,
    DeviceUnavailable,
    DeviceDisconnected,
    Cancelled,
    Playback,
}

#[derive(Debug, Clone, Copy, Deserialize, Type)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "action"
)]
pub enum AudioPreviewAction {
    Status,
    Pause,
    Resume,
    Seek {
        #[serde(rename = "positionMs")]
        position_ms: u32,
    },
    Volume {
        gain: f32,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AudioPreviewSnapshot {
    position_ms: u32,
    duration_ms: u32,
    playing: bool,
}

#[cfg(target_os = "macos")]
pub(in crate::project) use macos::duration_ms;
#[cfg(target_os = "macos")]
pub(crate) use macos::{control, shutdown, start, stop};

#[cfg(target_os = "macos")]
mod macos {
    use super::*;
    use crate::project::desktop_devices::{output_uid, output_uid_alive};
    use block2::RcBlock;
    use dispatch2::DispatchQueue;
    use objc2::{rc::Retained, AnyThread};
    use objc2_avf_audio::AVAudioPlayer;
    use objc2_core_audio::*;
    use objc2_foundation::{NSString, NSURL};
    use std::cell::RefCell;
    use std::path::Path;
    use std::ptr::NonNull;
    use tempfile::NamedTempFile;

    // The Tauri command dispatches these operations onto the main thread.
    // Keep all AVFAudio object access and drops on that same thread.
    thread_local! {
        static PLAYER: RefCell<Option<Player>> = const { RefCell::new(None) };
    }

    struct Player {
        token: String,
        player: Retained<AVAudioPlayer>,
        target_uid: Option<String>,
        duration_ms: u32,
        _source: NamedTempFile,
        _route: Option<RouteListener>,
    }

    impl Drop for Player {
        fn drop(&mut self) {
            // The private file outlives the player that reads it.
            unsafe { self.player.stop() };
        }
    }

    fn open_file(path: &Path) -> Result<Retained<AVAudioPlayer>, ()> {
        let path = path.to_str().ok_or(())?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        // AVFAudio receives a path to a private regular file held by the caller.
        unsafe { AVAudioPlayer::initWithContentsOfURL_error(AVAudioPlayer::alloc(), &url) }
            .map_err(|_| ())
    }

    fn player_duration_ms(player: &AVAudioPlayer) -> Result<u32, ()> {
        let millis = unsafe { player.duration() } * 1_000.0;
        if !millis.is_finite() || millis < 1.0 || millis > u32::MAX as f64 {
            return Err(());
        }
        Ok(millis.round() as u32)
    }

    pub(in crate::project) fn duration_ms(path: &Path) -> Result<u32, ()> {
        objc2::rc::autoreleasepool(|_| {
            let player = open_file(path)?;
            // Reading duration does not acquire an output device or start playback.
            player_duration_ms(&player)
        })
    }

    pub(crate) fn start(
        token: String,
        file: NamedTempFile,
        output: Option<&str>,
        position_ms: u32,
        gain: f32,
        on_disconnect: impl Fn() + 'static,
    ) -> Result<AudioPreviewSnapshot, AudioPreviewError> {
        let target_uid = match output {
            Some(name) => {
                let uid = output_uid(Some(name))
                    .filter(|uid| output_uid_alive(uid))
                    .ok_or(AudioPreviewError::DeviceUnavailable)?;
                Some(uid)
            }
            None => {
                output_uid(None).ok_or(AudioPreviewError::DeviceUnavailable)?;
                None
            }
        };
        let player = open_file(file.path()).map_err(|_| AudioPreviewError::SourceUnavailable)?;
        let duration_ms =
            player_duration_ms(&player).map_err(|_| AudioPreviewError::SourceUnavailable)?;
        let route = if target_uid.is_some() {
            Some(RouteListener::new(token.clone(), on_disconnect)?)
        } else {
            None
        };
        let next = Player {
            token,
            player,
            target_uid,
            duration_ms,
            _source: file,
            _route: route,
        };
        if !gain.is_finite() {
            return Err(AudioPreviewError::Playback);
        }
        let target = next.target_uid.as_deref().map(NSString::from_str);
        unsafe {
            next.player.setCurrentDevice(target.as_deref());
            next.player.setVolume(gain.clamp(0.0, 1.0));
            next.player.setCurrentTime(
                f64::from(if position_ms >= duration_ms {
                    0
                } else {
                    position_ms
                }) / 1_000.0,
            );
        }
        if !next.target_matches() {
            return Err(AudioPreviewError::DeviceUnavailable);
        }

        PLAYER.with_borrow_mut(|active| {
            // Stop the prior preview before the new player can make sound.
            active.take();
            next.play()?;
            let snapshot = next.snapshot();
            *active = Some(next);
            Ok(snapshot)
        })
    }

    impl Player {
        fn target_matches(&self) -> bool {
            self.target_uid.as_ref().is_none_or(|expected| {
                output_uid_alive(expected)
                    && unsafe { self.player.currentDevice() }
                        .is_some_and(|device| device.to_string() == *expected)
            })
        }

        fn play(&self) -> Result<(), AudioPreviewError> {
            if !self.target_matches() {
                return Err(AudioPreviewError::DeviceDisconnected);
            }
            // Configure the output before any audible frame. Recheck the
            // player's actual route once AVFAudio has acquired its hardware.
            let gain = unsafe { self.player.volume() };
            unsafe { self.player.setVolume(0.0) };
            if !unsafe { self.player.play() } {
                return Err(AudioPreviewError::Playback);
            }
            if !self.target_matches() {
                return Err(AudioPreviewError::DeviceDisconnected);
            }
            unsafe { self.player.setVolume(gain) };
            Ok(())
        }

        fn snapshot(&self) -> AudioPreviewSnapshot {
            AudioPreviewSnapshot {
                position_ms: ((unsafe { self.player.currentTime() } * 1_000.0).round() as u32)
                    .min(self.duration_ms),
                duration_ms: self.duration_ms,
                playing: unsafe { self.player.isPlaying() },
            }
        }
    }

    pub(crate) fn control(
        token: &str,
        action: AudioPreviewAction,
    ) -> Result<AudioPreviewSnapshot, AudioPreviewError> {
        PLAYER.with_borrow_mut(|slot| {
            let current = slot
                .as_ref()
                .filter(|player| player.token == token)
                .ok_or(AudioPreviewError::Cancelled)?;
            if !current.target_matches() {
                slot.take();
                return Err(AudioPreviewError::DeviceDisconnected);
            }
            let player = &current.player;
            match action {
                AudioPreviewAction::Status => {}
                AudioPreviewAction::Pause => unsafe { player.pause() },
                AudioPreviewAction::Resume => {
                    if current.snapshot().position_ms >= current.duration_ms {
                        unsafe { player.setCurrentTime(0.0) };
                    }
                    if let Err(error) = current.play() {
                        slot.take();
                        return Err(error);
                    }
                }
                AudioPreviewAction::Seek { position_ms } => unsafe {
                    player
                        .setCurrentTime(f64::from(position_ms.min(current.duration_ms)) / 1_000.0);
                },
                AudioPreviewAction::Volume { gain } if gain.is_finite() => unsafe {
                    player.setVolume(gain.clamp(0.0, 1.0));
                },
                AudioPreviewAction::Volume { .. } => return Err(AudioPreviewError::Playback),
            }
            Ok(current.snapshot())
        })
    }

    pub(crate) fn shutdown() {
        PLAYER.with_borrow_mut(|slot| {
            slot.take();
        });
    }

    fn stop_if_route_lost(token: &str) -> bool {
        PLAYER.with_borrow_mut(|slot| {
            if slot
                .as_ref()
                .is_some_and(|player| player.token == token && !player.target_matches())
            {
                slot.take();
                true
            } else {
                false
            }
        })
    }

    struct RouteListener(RcBlock<dyn Fn(u32, NonNull<AudioObjectPropertyAddress>)>);

    impl RouteListener {
        fn address() -> AudioObjectPropertyAddress {
            AudioObjectPropertyAddress {
                mSelector: kAudioHardwarePropertyDevices,
                mScope: kAudioObjectPropertyScopeGlobal,
                mElement: kAudioObjectPropertyElementMain,
            }
        }

        fn new(
            token: String,
            on_disconnect: impl Fn() + 'static,
        ) -> Result<Self, AudioPreviewError> {
            let listener = RcBlock::new(move |_: u32, _: NonNull<AudioObjectPropertyAddress>| {
                if stop_if_route_lost(&token) {
                    on_disconnect();
                }
            });
            // The HAL copies this listener, and calls it on the same main queue
            // as the player. It is removed when the owning preview is stopped.
            let status = unsafe {
                AudioObjectAddPropertyListenerBlock(
                    kAudioObjectSystemObject as u32,
                    NonNull::from(&mut Self::address()),
                    Some(DispatchQueue::main()),
                    RcBlock::as_ptr(&listener),
                )
            };
            if status != 0 {
                return Err(AudioPreviewError::DeviceUnavailable);
            }
            Ok(Self(listener))
        }
    }

    impl Drop for RouteListener {
        fn drop(&mut self) {
            // Match the object, property, dispatch queue and block of registration.
            unsafe {
                AudioObjectRemovePropertyListenerBlock(
                    kAudioObjectSystemObject as u32,
                    NonNull::from(&mut Self::address()),
                    Some(DispatchQueue::main()),
                    RcBlock::as_ptr(&self.0),
                );
            }
        }
    }

    pub(crate) fn stop(token: &str) {
        PLAYER.with_borrow_mut(|slot| {
            if slot.as_ref().is_some_and(|player| player.token == token) {
                slot.take();
            }
        });
    }
}
