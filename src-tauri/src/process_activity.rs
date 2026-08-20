//! App-Nap prevention for live sessions (user report on v1.2.2 #29).
//!
//! macOS App-Naps an occluded app — another Space or a fullscreen app in
//! front of the window: its timers throttle, and the children it spawned
//! (scsynth, the score server) can be suspended mid-startup. Switching
//! back then resumed the load from wherever it froze, with the loading
//! screen picking up at its last stage instead of having finished long
//! before. A performance host must keep working while covered.
//!
//! [`ProcessActivity`] holds an `NSProcessInfo` activity while a session
//! is live (starting / ready / stopping) and releases it once the
//! session settles to idle/error — see `SessionInner`'s refresh in
//! `SessionManager::emit`, the single funnel every state publication
//! passes through.

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_foundation::{NSActivityOptions, NSObjectProtocol, NSProcessInfo, NSString};

/// A held `NSProcessInfo` activity; dropped = ended.
pub struct ProcessActivity {
    activity: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

// The activity token crosses supervisor threads inside the session
// manager's Mutex. NSProcessInfo's activity API is thread-safe (the
// singleton itself is Send+Sync, and begin/end may run on any thread),
// so moving the token between threads is sound.
unsafe impl Send for ProcessActivity {}

impl ProcessActivity {
    pub fn begin(reason: &str) -> Self {
        let activity = NSProcessInfo::processInfo().beginActivityWithOptions_reason(
            // Strong enough to defeat occlusion App Nap for the app
            // and its children, without keeping the whole machine
            // awake when the user walks away (idle system sleep stays
            // allowed).
            NSActivityOptions::UserInitiatedAllowingIdleSystemSleep,
            &NSString::from_str(reason),
        );
        Self { activity }
    }
}

impl Drop for ProcessActivity {
    fn drop(&mut self) {
        unsafe {
            NSProcessInfo::processInfo().endActivity(&self.activity);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn activity_holds_and_releases() {
        // Round-trip on the test runner: begin, drop, begin again — a
        // doubled begin is the interesting part (idempotent refresh
        // never stacks, but two sequential lifetimes must both work).
        let first = ProcessActivity::begin("pnds-test");
        drop(first);
        let _second = ProcessActivity::begin("pnds-test");
    }
}
