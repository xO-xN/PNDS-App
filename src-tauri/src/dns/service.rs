//! #174: SMAppService as the LaunchDaemon's registration surface
//! (macOS 13+, the App's minimum). All calls are `unsafe` only where the
//! bindings require it; none of them store or handle an admin password —
//! the one-time approval is the system's dialog, and the daemon itself is
//! system-managed afterwards (survives login/reboot per the spec).

use crate::dns::{DnsRegistrationStatus, DAEMON_PLIST_NAME};
use objc2_foundation::NSString;

/// The LaunchDaemon plist inside THIS bundle
/// (`Contents/Library/LaunchDaemons/<name>`). `None` outside a proper
/// .app bundle (dev runs) — enabling requires the installed app.
pub fn plist_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let contents = exe
        .ancestors()
        .find(|path| path.file_name().is_some_and(|name| name == "Contents"))?;
    let plist = contents
        .join("Library/LaunchDaemons")
        .join(DAEMON_PLIST_NAME);
    plist.exists().then_some(plist)
}

/// Queries the registration state. `NotFound` means the system knows the
/// registration but the bundle moved — the settings section renders a
/// reinstall hint for it.
pub fn registration_status() -> DnsRegistrationStatus {
    if !plist_path().is_some() {
        // Nothing to ask about in a dev bundle — report the honest state
        // instead of calling into SMAppService with a nonexistent plist.
        return DnsRegistrationStatus::NotRegistered;
    }
    let Some(service) = daemon_service() else {
        return DnsRegistrationStatus::NotRegistered;
    };
    match unsafe { service.status() } {
        s if s == objc2_service_management::SMAppServiceStatus::Enabled => {
            DnsRegistrationStatus::Enabled
        }
        s if s == objc2_service_management::SMAppServiceStatus::RequiresApproval => {
            DnsRegistrationStatus::RequiresApproval
        }
        s if s == objc2_service_management::SMAppServiceStatus::NotFound => {
            DnsRegistrationStatus::NotFound
        }
        _ => DnsRegistrationStatus::NotRegistered,
    }
}

/// Registers the LaunchDaemon. This is the operator's one-time approval:
/// the system shows its dialog and this call returns once the flow
/// completes. Must be called from a non-main thread (the blocking
/// variant parks the caller).
pub fn register() -> Result<(), String> {
    let Some(service) = daemon_service() else {
        return Err("the bundled DNS daemon plist is missing".to_string());
    };
    unsafe { service.registerAndReturnError() }
        .map_err(|error| format!("the system refused the DNS daemon registration: {error}"))
}

/// Unregisters the LaunchDaemon — the daemon stops, the port is freed,
/// and the registration is removed together.
pub fn unregister() -> Result<(), String> {
    let Some(service) = daemon_service() else {
        return Err("the bundled DNS daemon plist is missing".to_string());
    };
    unsafe { service.unregisterAndReturnError() }
        .map_err(|error| format!("the system refused the DNS daemon unregistration: {error}"))
}

/// Opens System Settings at the Login Items panel — the recovery path
/// when the approval was dismissed (status `requiresApproval`).
pub fn open_system_settings_login_items() -> Result<(), String> {
    let Some(_service) = daemon_service() else {
        return Err("the bundled DNS daemon plist is missing".to_string());
    };
    unsafe { objc2_service_management::SMAppService::openSystemSettingsLoginItems() };
    Ok(())
}

fn daemon_service() -> Option<objc2::rc::Retained<objc2_service_management::SMAppService>> {
    // Class accessor + status are FFI calls — unsafe by binding design.
    unsafe {
        Some(
            objc2_service_management::SMAppService::daemonServiceWithPlistName(
                &NSString::from_str(DAEMON_PLIST_NAME),
            ),
        )
    }
}
