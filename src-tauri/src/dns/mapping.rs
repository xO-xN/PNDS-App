//! One performance mapping's ownership, including uncertain installation.
//! Session teardown owns this handle before the first request is sent.
//! The operation lock orders install/refresh/revoke without holding the
//! session lock across socket I/O; revocation also retires future installs.

use super::{client, run_id, MAPPING_LEASE};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Default)]
struct Ownership {
    retired: bool,
    cleanup_pending: bool,
}

pub(crate) struct MappingLease {
    socket: PathBuf,
    generation: u64,
    ownership: Mutex<Ownership>,
}

impl MappingLease {
    pub(crate) fn new(generation: u64) -> Self {
        Self::new_on(generation, client::control_socket_path())
    }

    pub(crate) fn new_on(generation: u64, socket: PathBuf) -> Self {
        Self {
            socket,
            generation,
            ownership: Mutex::new(Ownership::default()),
        }
    }

    fn call(&self, op: &str, payload: Value) -> Result<Value, String> {
        client::call_on(&self.socket, op, payload, REQUEST_TIMEOUT)
    }

    fn holder(&self) -> Value {
        json!({ "runId": run_id(), "generation": self.generation })
    }

    pub(crate) fn install(&self, domain: &str, ip: &str) -> Result<(), String> {
        let mut ownership = self.ownership.lock().unwrap_or_else(|e| e.into_inner());
        if ownership.retired {
            return Err("the DNS mapping's session has ended".to_string());
        }
        if ip.parse::<std::net::Ipv4Addr>().is_err() {
            return Err(format!("the DNS mapping IP is not an IPv4 address: {ip}"));
        }
        // A lost response does not prove that mapping.set had no effect.
        ownership.cleanup_pending = true;
        let install = (|| {
            let mut payload = self.holder();
            payload["domain"] = domain.into();
            payload["ip"] = ip.into();
            payload["leaseSeconds"] = MAPPING_LEASE.as_secs().into();
            self.call("mapping.set", payload)?;
            let verify = self.call("verify", json!({ "domain": domain }))?;
            let resolved = verify.get("resolved").and_then(Value::as_str);
            match resolved {
                Some(resolved) if resolved == ip => Ok(()),
                other => Err(format!(
                    "the DNS mapping did not verify (resolved {other:?}, expected {ip})"
                )),
            }
        })();
        if install.is_err() {
            // No renewal after failure. A failed rollback keeps the
            // obligation alive for teardown, then the lease is the net.
            ownership.retired = true;
            self.clear(&mut ownership);
        }
        install
    }

    pub(crate) fn refresh(&self) -> Result<(), String> {
        let ownership = self.ownership.lock().unwrap_or_else(|e| e.into_inner());
        if ownership.retired || !ownership.cleanup_pending {
            return Err("the DNS mapping's session has ended".to_string());
        }
        let mut payload = self.holder();
        payload["leaseSeconds"] = MAPPING_LEASE.as_secs().into();
        self.call("mapping.refresh", payload).map(|_| ())
    }

    pub(crate) fn revoke(&self) {
        let mut ownership = self.ownership.lock().unwrap_or_else(|e| e.into_inner());
        ownership.retired = true;
        self.clear(&mut ownership);
    }

    fn clear(&self, ownership: &mut Ownership) {
        if !ownership.cleanup_pending {
            return;
        }
        match client::request_on(
            &self.socket,
            "mapping.clear",
            self.holder(),
            REQUEST_TIMEOUT,
        ) {
            Ok(response)
                if response.get("ok").and_then(Value::as_bool) == Some(true)
                    || response.get("code").and_then(Value::as_str) == Some("notHolder") =>
            {
                // A newer holder owns the mapping: ours is already gone.
                ownership.cleanup_pending = false;
            }
            Ok(response) => log::warn!(
                "DNS mapping cleanup refused ({}); cleanup remains pending until retry or lease expiry",
                response
                    .get("code")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
            ),
            Err(e) => log::warn!(
                "DNS mapping cleanup unconfirmed ({e}); cleanup remains pending until retry or lease expiry"
            ),
        }
    }
}

#[cfg(test)]
mod tests;
