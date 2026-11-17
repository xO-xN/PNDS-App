//! Test-only TCP pools and cross-process leases shared by library and CLI fixtures.

/// Run a descriptor-topology case after exec, so unrelated parallel tests cannot
/// fork copies of the sockets this case is about to create. The parent suite
/// keeps its normal concurrency; only this exact case runs in the child.
#[cfg(test)]
pub(crate) fn run_isolated_test() -> bool {
    const GUARD: &str = "PNDS_ISOLATED_TEST_CASE";
    let thread = std::thread::current();
    let name = thread
        .name()
        .expect("isolated case must run on its test thread");
    if std::env::var(GUARD).as_deref() == Ok(name) {
        return false;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            name,
            "--nocapture",
            "--format",
            "pretty",
            "--color",
            "never",
        ])
        .env(GUARD, name)
        .output()
        .expect("could not start isolated descriptor-topology case");
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success(),
        "isolated {name} failed: {stdout}\n{stderr}"
    );
    assert!(
        stdout.contains("running 1 test")
            && stdout.contains(&format!("test {name} ... ok"))
            && stdout.contains("1 passed; 0 failed; 0 ignored"),
        "isolated filter must execute exactly its requested case: {stdout}\n{stderr}"
    );
    true
}
pub(crate) fn automatic_tcp_port_ranges() -> std::io::Result<Vec<std::ops::RangeInclusive<u16>>> {
    #[cfg(target_os = "macos")]
    {
        fn value(name: &std::ffi::CStr) -> std::io::Result<u16> {
            let mut port: libc::c_int = 0;
            let mut length = std::mem::size_of_val(&port);
            // SAFETY: the output points to a live integer with its exact size;
            // a null new-value pointer makes this a read-only kernel query.
            if unsafe {
                libc::sysctlbyname(
                    name.as_ptr(),
                    std::ptr::from_mut(&mut port).cast(),
                    &mut length,
                    std::ptr::null_mut(),
                    0,
                )
            } != 0
            {
                return Err(std::io::Error::last_os_error());
            }
            if length != std::mem::size_of_val(&port) {
                return Err(std::io::Error::other("Unexpected TCP port-range size"));
            }
            u16::try_from(port).map_err(std::io::Error::other)
        }
        let first = value(c"net.inet.ip.portrange.first")?;
        let last = value(c"net.inet.ip.portrange.last")?;
        let high_first = value(c"net.inet.ip.portrange.hifirst")?;
        let high_last = value(c"net.inet.ip.portrange.hilast")?;
        let low_first = value(c"net.inet.ip.portrange.lowfirst")?;
        let low_last = value(c"net.inet.ip.portrange.lowlast")?;
        Ok(vec![
            first.min(last)..=first.max(last),
            high_first.min(high_last)..=high_first.max(high_last),
            low_first.min(low_last)..=low_first.max(low_last),
        ])
    }
    #[cfg(not(target_os = "macos"))]
    {
        let values = std::fs::read_to_string("/proc/sys/net/ipv4/ip_local_port_range")?;
        let ports: Vec<u16> = values
            .split_whitespace()
            .map(str::parse)
            .collect::<Result<_, _>>()
            .map_err(std::io::Error::other)?;
        match ports.as_slice() {
            [first, last] => Ok(vec![*first.min(last)..=*first.max(last)]),
            _ => Err(std::io::Error::other("Unexpected TCP port range")),
        }
    }
}

/// Unlike std's Darwin listener, this reservation never enables address reuse.
fn exclusive_tcp_listener(port: u16) -> std::io::Result<std::net::TcpListener> {
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};

    // SAFETY: socket creates a new owned IPv4 stream descriptor, or returns -1.
    let raw = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
    if raw < 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: this is the sole owner of the newly created descriptor. OwnedFd
    // closes it on every configuration, bind or listen error below.
    let descriptor = unsafe { OwnedFd::from_raw_fd(raw) };
    // SAFETY: fcntl operates on the live descriptor without transferring it.
    let flags = unsafe { libc::fcntl(descriptor.as_raw_fd(), libc::F_GETFD) };
    if flags < 0
        || unsafe {
            libc::fcntl(
                descriptor.as_raw_fd(),
                libc::F_SETFD,
                flags | libc::FD_CLOEXEC,
            )
        } < 0
    {
        return Err(std::io::Error::last_os_error());
    }
    let disabled: libc::c_int = 0;
    for option in [libc::SO_REUSEADDR, libc::SO_REUSEPORT] {
        // SAFETY: disabled points to a live integer of the supplied exact size.
        if unsafe {
            libc::setsockopt(
                descriptor.as_raw_fd(),
                libc::SOL_SOCKET,
                option,
                std::ptr::from_ref(&disabled).cast(),
                std::mem::size_of_val(&disabled) as libc::socklen_t,
            )
        } != 0
        {
            return Err(std::io::Error::last_os_error());
        }
    }
    // SAFETY: all-zero sockaddr_in fields are valid; the required address
    // family, length and network-byte-order port are then initialized below.
    let mut address: libc::sockaddr_in = unsafe { std::mem::zeroed() };
    #[cfg(target_os = "macos")]
    {
        address.sin_len = std::mem::size_of_val(&address) as u8;
    }
    address.sin_family = libc::AF_INET as libc::sa_family_t;
    address.sin_port = port.to_be();
    // The zero sin_addr is INADDR_ANY, covering all local IPv4 interfaces.
    // SAFETY: address is an initialized IPv4 sockaddr with its exact size.
    if unsafe {
        libc::bind(
            descriptor.as_raw_fd(),
            std::ptr::from_ref(&address).cast(),
            std::mem::size_of_val(&address) as libc::socklen_t,
        )
    } != 0
    {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: this live stream socket is bound and retains its sole owner.
    if unsafe { libc::listen(descriptor.as_raw_fd(), libc::SOMAXCONN) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(descriptor.into())
}

/// One test server's number lease survives listener handoff to its real child.
#[derive(Debug)]
pub(crate) struct TcpPortReservation {
    port: u16,
    listener: Option<std::net::TcpListener>,
    _lease: std::fs::File,
}

impl TcpPortReservation {
    pub(crate) fn reserve() -> std::io::Result<Self> {
        let automatic = automatic_tcp_port_ranges()?;
        for port in (10240..=u16::MAX).chain(1024..10240) {
            if automatic.iter().any(|range| range.contains(&port)) {
                continue;
            }
            if let Some(reservation) = Self::try_reserve(port)? {
                return Ok(reservation);
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::AddrNotAvailable,
            "Could not select a fixture port outside the kernel automatic pools",
        ))
    }

    fn try_reserve(port: u16) -> std::io::Result<Option<Self>> {
        use std::os::fd::AsRawFd;
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};

        // A shared host/user path, independent of HOME, checkout or fixture
        // temp directories. Never unlink a lock file: that would split leases
        // across old and replacement inodes while other processes still hold it.
        // SAFETY: getuid only reads this process's real user ID.
        let user = unsafe { libc::getuid() };
        let directory = std::path::Path::new("/tmp").join(format!("pnds-test-tcp-ports-{user}"));
        std::fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(&directory)?;
        let lease = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(directory.join(format!("{port}.lock")))?;
        // SAFETY: the live File owns this descriptor. Nonblocking flock
        // coordinates test processes without serializing complete tests.
        if unsafe { libc::flock(lease.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
            let error = std::io::Error::last_os_error();
            return if error.kind() == std::io::ErrorKind::WouldBlock {
                Ok(None)
            } else {
                Err(error)
            };
        }
        match exclusive_tcp_listener(port) {
            Ok(listener) => Ok(Some(Self {
                port,
                listener: Some(listener),
                _lease: lease,
            })),
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub(crate) fn port(&self) -> u16 {
        self.port
    }

    pub(crate) fn take_listener(&mut self) -> Option<std::net::TcpListener> {
        self.listener.take()
    }

    pub(crate) fn release_for_start(&mut self) {
        self.listener = None;
    }
}

/// Observe completed parent cleanup while transient pre-exec socket copies end.
/// This never retries runtime startup or creates a listening probe of its own.
pub(crate) fn wait_for_tcp_listener_release(address: std::net::SocketAddr) -> std::io::Result<()> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let mut last_observation = "not probed".to_string();
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        if remaining.is_zero() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("TCP listener {address} did not settle after parent cleanup; last observation: {last_observation}"),
            ));
        }
        match std::net::TcpStream::connect_timeout(
            &address,
            remaining.min(std::time::Duration::from_millis(100)),
        ) {
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => return Ok(()),
            // A pre-exec copy can disappear during the handshake. Reset is
            // an unsettled observation, never evidence of release.
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionReset => {
                last_observation = error.to_string();
            }
            Err(error) => {
                return Err(std::io::Error::new(
                    error.kind(),
                    format!("TCP listener release at {address}: {error}"),
                ))
            }
            Ok(connection) => {
                drop(connection);
                last_observation = "connection accepted".into();
            }
        }
        std::thread::sleep(
            std::time::Duration::from_millis(5)
                .min(deadline.saturating_duration_since(std::time::Instant::now())),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reservation_transfers_its_live_listener_once_without_rebinding() {
        let mut reservation = TcpPortReservation::reserve().unwrap();
        let port = reservation.port();
        let listener = reservation.take_listener().unwrap();
        assert!(reservation.take_listener().is_none());
        reservation.release_for_start();
        assert_eq!(listener.local_addr().unwrap().port(), port);
        let blocked = std::net::TcpListener::bind(("0.0.0.0", port)).unwrap_err();
        assert_eq!(blocked.kind(), std::io::ErrorKind::AddrInUse);
    }

    #[test]
    fn reservation_listener_disables_reuse_and_closes_on_exec() {
        use std::os::fd::AsRawFd;

        let listener = exclusive_tcp_listener(0).unwrap();
        for option in [libc::SO_REUSEADDR, libc::SO_REUSEPORT] {
            let mut enabled: libc::c_int = -1;
            let mut length = std::mem::size_of_val(&enabled) as libc::socklen_t;
            // SAFETY: both output pointers reference live values of the exact
            // advertised size; the listener owns the queried descriptor.
            assert_eq!(
                unsafe {
                    libc::getsockopt(
                        listener.as_raw_fd(),
                        libc::SOL_SOCKET,
                        option,
                        std::ptr::from_mut(&mut enabled).cast(),
                        &mut length,
                    )
                },
                0
            );
            assert_eq!(enabled, 0);
        }
        // SAFETY: this read-only descriptor query does not change ownership.
        let flags = unsafe { libc::fcntl(listener.as_raw_fd(), libc::F_GETFD) };
        assert!(flags >= 0 && flags & libc::FD_CLOEXEC != 0);
    }

    #[test]
    fn reservation_rejects_a_port_held_on_a_single_lan_address() {
        if run_isolated_test() {
            return;
        }
        let address = if_addrs::get_if_addrs()
            .unwrap()
            .into_iter()
            .find_map(|interface| match interface.addr {
                if_addrs::IfAddr::V4(address) if !address.ip.is_loopback() => Some(address.ip),
                _ => None,
            });
        let Some(address) = address else {
            eprintln!("No LAN IPv4 available for the single-address fixture regression");
            return;
        };
        let mut reservation = TcpPortReservation::reserve().unwrap();
        let port = reservation.port();
        reservation.release_for_start();
        let occupant = std::net::TcpListener::bind((address, port)).unwrap();
        // A loopback-only probe succeeds despite the real LAN listener.
        let loopback_probe = std::net::TcpListener::bind(("127.0.0.1", port)).unwrap();
        drop(loopback_probe);
        drop(reservation);
        let conflict = exclusive_tcp_listener(port)
            .err()
            .expect("an exclusive wildcard bind must reject the LAN listener");
        assert_eq!(conflict.kind(), std::io::ErrorKind::AddrInUse);
        assert!(
            TcpPortReservation::try_reserve(port).unwrap().is_none(),
            "fixture reservation missed the listener at {address}:{port}"
        );
        assert_eq!(occupant.local_addr().unwrap().ip(), address);
    }
}

#[cfg(test)]
mod listener_release_tests {
    use super::*;

    #[tokio::test]
    async fn released_listener_can_be_observed_while_its_port_is_an_established_outbound_source() {
        if run_isolated_test() {
            return;
        }
        let mut former = TcpPortReservation::reserve().unwrap();
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], former.port()));
        former.release_for_start();
        let peer = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket.set_reuseaddr(false).unwrap();
        socket.bind(address).unwrap();
        let outgoing = socket.connect(peer.local_addr().unwrap()).await.unwrap();
        let (incoming, source) = peer.accept().unwrap();
        assert_eq!(source, address);
        assert_eq!(outgoing.local_addr().unwrap(), address);
        // An exclusive bind asks for numeric-port availability, a stronger
        // property than absence of the completed fixture's listener. Darwin's
        // std listener enables SO_REUSEADDR and may allow this overlap instead.
        let bind_error = exclusive_tcp_listener(address.port()).unwrap_err();
        assert_eq!(bind_error.kind(), std::io::ErrorKind::AddrInUse);
        wait_for_tcp_listener_release(address).unwrap();
        assert_eq!(incoming.peer_addr().unwrap(), address);
    }

    #[test]
    fn a_held_listener_is_not_reported_as_released() {
        if run_isolated_test() {
            return;
        }
        let mut held = TcpPortReservation::reserve().unwrap();
        let address = std::net::SocketAddr::from(([127, 0, 0, 1], held.port()));
        let listener = held.take_listener().unwrap();
        let error = wait_for_tcp_listener_release(address).unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::TimedOut);
        assert_eq!(listener.local_addr().unwrap().port(), address.port());
    }
}
