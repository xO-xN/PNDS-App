//! Thin, synchronous ownership wrapper around the system DNS-SD client.

use super::*;
use std::collections::BTreeMap;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::net::Ipv4Addr;
use std::ptr::{null, null_mut, NonNull};
use std::time::Duration;

const SERVICE: &CStr = c"_pnds-score._tcp";
const LOCAL: &CStr = c"local.";
const TXT: u16 = 16;
const INTERNET: u16 = 1;
const ADD: u32 = 2;
const MAX_NODES: usize = 128;
const MAX_TXT: usize = 768;

type RawRef = *mut c_void;
type BrowseCallback = unsafe extern "C" fn(
    RawRef,
    u32,
    u32,
    i32,
    *const c_char,
    *const c_char,
    *const c_char,
    *mut c_void,
);
type RegisterCallback = unsafe extern "C" fn(
    RawRef,
    u32,
    i32,
    *const c_char,
    *const c_char,
    *const c_char,
    *mut c_void,
);
type QueryCallback = unsafe extern "C" fn(
    RawRef,
    u32,
    u32,
    i32,
    *const c_char,
    u16,
    u16,
    u16,
    *const c_void,
    u32,
    *mut c_void,
);

extern "C" {
    fn DNSServiceBrowse(
        result: *mut RawRef,
        flags: u32,
        interface: u32,
        service: *const c_char,
        domain: *const c_char,
        callback: BrowseCallback,
        context: *mut c_void,
    ) -> i32;
    fn DNSServiceRegister(
        result: *mut RawRef,
        flags: u32,
        interface: u32,
        name: *const c_char,
        service: *const c_char,
        domain: *const c_char,
        host: *const c_char,
        port: u16,
        length: u16,
        txt: *const c_void,
        callback: Option<RegisterCallback>,
        context: *mut c_void,
    ) -> i32;
    fn DNSServiceQueryRecord(
        result: *mut RawRef,
        flags: u32,
        interface: u32,
        fullname: *const c_char,
        record_type: u16,
        record_class: u16,
        callback: QueryCallback,
        context: *mut c_void,
    ) -> i32;
    fn DNSServiceConstructFullName(
        result: *mut c_char,
        name: *const c_char,
        service: *const c_char,
        domain: *const c_char,
    ) -> i32;
    fn DNSServiceRefSockFD(service: RawRef) -> c_int;
    fn DNSServiceProcessResult(service: RawRef) -> i32;
    fn DNSServiceRefDeallocate(service: RawRef);
}

struct Reference(NonNull<c_void>);

impl Reference {
    fn open(create: impl FnOnce(*mut RawRef) -> i32) -> Result<Self, i32> {
        let mut reference = null_mut();
        let status = create(&mut reference);
        if status != 0 {
            return Err(status);
        }
        NonNull::new(reference).map(Self).ok_or(-1)
    }

    fn poll(&self) -> libc::pollfd {
        // SAFETY: this reference is live and owned exclusively by this worker.
        let fd = unsafe { DNSServiceRefSockFD(self.0.as_ptr()) };
        libc::pollfd {
            fd,
            events: libc::POLLIN,
            revents: 0,
        }
    }

    fn process(&self, socket: libc::pollfd) -> bool {
        if socket.revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL) != 0 {
            return false;
        }
        // SAFETY: a readable socket guarantees a result is ready. Callbacks run
        // only here, on the thread that owns their boxed contexts.
        socket.revents & libc::POLLIN == 0
            || unsafe { DNSServiceProcessResult(self.0.as_ptr()) == 0 }
    }
}

impl Drop for Reference {
    fn drop(&mut self) {
        // SAFETY: only this owner deallocates a successfully opened reference.
        unsafe { DNSServiceRefDeallocate(self.0.as_ptr()) }
    }
}

type Service = (u32, CString);

#[derive(Default)]
struct BrowseEvents {
    services: Vec<(bool, Service)>,
    failed: bool,
}

unsafe extern "C" fn on_browse(
    _: RawRef,
    flags: u32,
    interface: u32,
    error: i32,
    name: *const c_char,
    service: *const c_char,
    domain: *const c_char,
    context: *mut c_void,
) {
    // SAFETY: browse_once holds this Box until its service ref is dropped.
    let events = unsafe { &mut *context.cast::<BrowseEvents>() };
    if error != 0 {
        events.failed = true;
    } else if !name.is_null()
        && !service.is_null()
        && !domain.is_null()
        && events.services.len() < MAX_NODES * 2
    {
        // dns_sd.h requires kDNSServiceMaxDomainName (1009) bytes for the
        // escaped full name. The function guarantees NUL termination on success.
        let mut full = [0; 1009];
        if unsafe { DNSServiceConstructFullName(full.as_mut_ptr(), name, service, domain) } == 0 {
            let full = unsafe { CStr::from_ptr(full.as_ptr()) }.to_owned();
            events.services.push((flags & ADD != 0, (interface, full)));
        }
    }
}

struct Query {
    reference: Reference,
    node: Box<Option<ClientLanNode>>,
}

impl Query {
    fn open((interface, full): &Service) -> Result<Self, i32> {
        let mut node = Box::new(None);
        let reference = Reference::open(|result| {
            // SAFETY: the DNS-SD API copies full and only calls back through
            // process(); the boxed node outlives reference in declaration order.
            unsafe {
                DNSServiceQueryRecord(
                    result,
                    0,
                    *interface,
                    full.as_ptr(),
                    TXT,
                    INTERNET,
                    on_query,
                    (&mut *node as *mut Option<ClientLanNode>).cast(),
                )
            }
        })?;
        Ok(Self { reference, node })
    }
}

unsafe extern "C" fn on_query(
    _: RawRef,
    flags: u32,
    _: u32,
    error: i32,
    _: *const c_char,
    record_type: u16,
    record_class: u16,
    length: u16,
    data: *const c_void,
    _: u32,
    context: *mut c_void,
) {
    // SAFETY: Query owns the boxed node; DNS-SD provides length valid bytes
    // during this callback, and no slice escapes it.
    let node = unsafe { &mut *context.cast::<Option<ClientLanNode>>() };
    if error != 0 {
        *node = None;
    } else if record_type == TXT
        && record_class == INTERNET
        && !data.is_null()
        && usize::from(length) <= MAX_TXT
    {
        let bytes = unsafe { std::slice::from_raw_parts(data.cast::<u8>(), usize::from(length)) };
        if let Some(reported) = decode(bytes) {
            if flags & ADD != 0 {
                *node = Some(reported);
            } else if node.as_ref() == Some(&reported) {
                *node = None;
            }
        }
    }
}

fn register(local: &Announcement) -> Result<Reference, i32> {
    let identity = &local.identity;
    let prefix = &identity.node_id[..16];
    let name = CString::new(format!("PNDS-{prefix}")).map_err(|_| -1)?;
    let txt = encode(local);
    Reference::open(|result| {
        // SAFETY: input strings and TXT bytes are copied by DNS-SD.
        unsafe {
            DNSServiceRegister(
                result,
                0,
                identity.interface,
                name.as_ptr(),
                SERVICE.as_ptr(),
                LOCAL.as_ptr(),
                null(),
                identity.address.port().to_be(),
                txt.len() as u16,
                txt.as_ptr().cast(),
                None,
                null_mut(),
            )
        }
    })
}

pub(super) fn browse(
    receiver: mpsc::Receiver<Option<Announcement>>,
    nodes: Arc<Mutex<Vec<ClientLanNode>>>,
) {
    let mut local = None;
    loop {
        if let Err(error) = browse_once(&receiver, &nodes, &mut local, 0) {
            log::warn!("PNDS LAN discovery unavailable: {error}");
        } else {
            return;
        }
        nodes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
        match receiver.recv_timeout(Duration::from_secs(2)) {
            Ok(announcement) => local = announcement,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}

fn browse_once(
    receiver: &mpsc::Receiver<Option<Announcement>>,
    nodes: &Mutex<Vec<ClientLanNode>>,
    local: &mut Option<Announcement>,
    interface: u32,
) -> Result<(), i32> {
    let mut events = Box::<BrowseEvents>::default();
    let browser = Reference::open(|result| {
        // SAFETY: the stable boxed context outlives browser and its callbacks.
        unsafe {
            DNSServiceBrowse(
                result,
                0,
                interface,
                SERVICE.as_ptr(),
                LOCAL.as_ptr(),
                on_browse,
                (&mut *events as *mut BrowseEvents).cast(),
            )
        }
    })?;
    let mut queries = BTreeMap::<Service, Query>::new();
    let mut registration = None;
    let mut published = None;
    loop {
        loop {
            match receiver.try_recv() {
                Ok(announcement) => *local = announcement,
                Err(mpsc::TryRecvError::Empty) => break,
                Err(mpsc::TryRecvError::Disconnected) => return Ok(()),
            }
        }
        if *local != published {
            // A fresh registration delivers a browse removal/addition even
            // where the daemon does not deliver in-place TXT changes. Peers
            // keep the same node identity across announcement generations.
            drop(registration.take());
            registration = local.as_ref().map(register).transpose()?;
            published = local.clone();
        }
        let mut sockets = vec![browser.poll()];
        sockets.extend(queries.values().map(|query| query.reference.poll()));
        // SAFETY: sockets is writable and bounded by MAX_NODES + one browser.
        let status =
            unsafe { libc::poll(sockets.as_mut_ptr(), sockets.len() as libc::nfds_t, 150) };
        if status < 0 {
            if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                continue;
            }
            return Err(-1);
        }
        if !browser.process(sockets[0]) || events.failed {
            return Err(-1);
        }
        let mut sockets = sockets.into_iter().skip(1);
        queries.retain(|_, query| {
            query
                .reference
                .process(sockets.next().expect("query poll descriptor"))
        });
        for (add, service) in events.services.drain(..) {
            if add {
                if queries.len() < MAX_NODES && !queries.contains_key(&service) {
                    if let Ok(query) = Query::open(&service) {
                        queries.insert(service, query);
                    }
                }
            } else {
                queries.remove(&service);
            }
        }
        let mut observed = BTreeMap::new();
        for node in queries
            .values()
            .filter_map(|query| query.node.as_ref().as_ref())
        {
            observed.entry(&node.node_id).or_insert(node);
        }
        let mut current = nodes.lock().unwrap_or_else(|error| error.into_inner());
        if current.iter().ne(observed.values().copied()) {
            *current = observed.into_values().cloned().collect();
        }
    }
}

fn encode(local: &Announcement) -> Vec<u8> {
    let role = match local.run.role.unwrap_or(local.identity.role) {
        LanNodeRole::Host => "host",
        LanNodeRole::Client => "client",
        LanNodeRole::Creation => "creation",
    };
    let mut text = Vec::new();
    let mut field = |key: &str, value: &str| {
        let limit = u8::MAX as usize - key.len() - 1;
        let end = value
            .char_indices()
            .map(|(offset, _)| offset)
            .chain([value.len()])
            .take_while(|offset| *offset <= limit)
            .last()
            .unwrap_or(0);
        text.push((key.len() + 1 + end) as u8);
        text.extend_from_slice(key.as_bytes());
        text.push(b'=');
        text.extend_from_slice(&value.as_bytes()[..end]);
    };
    field("v", "1");
    field("id", &local.identity.node_id);
    field("name", &local.identity.node_name);
    field("role", role);
    field("ip", &local.identity.address.ip().to_string());
    field("port", &local.identity.address.port().to_string());
    if let Some(project) = &local.run.project_name {
        field("project", project);
    }
    if local.run.loading {
        field("loading", "1");
    }
    text
}

fn decode(mut bytes: &[u8]) -> Option<ClientLanNode> {
    let mut fields = BTreeMap::new();
    while let Some((&size, remaining)) = bytes.split_first() {
        let (value, rest) = remaining.split_at_checked(usize::from(size))?;
        let (name, value) = std::str::from_utf8(value).ok()?.split_once('=')?;
        if fields.insert(name, value).is_some() {
            return None;
        }
        bytes = rest;
    }
    if *fields.get("v")? != "1" {
        return None;
    }
    let id = *fields.get("id")?;
    let name = fields.get("name")?.trim();
    if id.len() != 64
        || !id.bytes().all(|byte| byte.is_ascii_hexdigit())
        || name.is_empty()
        || name.len() > 160
        || name.chars().any(char::is_control)
    {
        return None;
    }
    let role = match *fields.get("role")? {
        "host" => LanNodeRole::Host,
        "client" => LanNodeRole::Client,
        "creation" => LanNodeRole::Creation,
        _ => return None,
    };
    let ip: Ipv4Addr = fields.get("ip")?.parse().ok()?;
    let port: u16 = fields.get("port")?.parse().ok()?;
    if port == 0 || !(ip.is_private() || ip.is_link_local()) {
        return None;
    }
    Some(ClientLanNode {
        node_id: id.to_owned(),
        node_name: name.into(),
        role,
        address: (role != LanNodeRole::Client).then(|| format!("http://{ip}:{port}/")),
        project_name: fields
            .get("project")
            .filter(|value| {
                role != LanNodeRole::Client
                    && !value.trim().is_empty()
                    && !value.chars().any(char::is_control)
            })
            .map(|value| (*value).to_owned()),
        loading: role != LanNodeRole::Client && fields.get("loading") == Some(&"1"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn local() -> Announcement {
        Announcement {
            identity: LanIdentity {
                node_id: "a".repeat(64),
                node_name: "排练工作站".into(),
                role: LanNodeRole::Client,
                address: "192.168.1.24:5400".parse().unwrap(),
                interface: 1,
            },
            run: LanRun::default(),
        }
    }

    #[test]
    fn round_trip_one_stable_identity_through_client_creation_and_host() {
        let mut local = local();
        let client = decode(&encode(&local)).unwrap();
        assert_eq!(client.node_name, "排练工作站");
        assert_eq!(client.role, LanNodeRole::Client);
        assert_eq!(client.address, None);
        local.run = LanRun {
            role: Some(LanNodeRole::Creation),
            loading: true,
            project_name: None,
        };
        let preparing = decode(&encode(&local)).unwrap();
        assert_eq!(preparing.node_id, client.node_id);
        assert_eq!(preparing.role, LanNodeRole::Creation);
        assert!(preparing.loading);
        local.run = LanRun {
            role: Some(LanNodeRole::Host),
            loading: false,
            project_name: Some("海".repeat(200)),
        };
        let host = decode(&encode(&local)).unwrap();
        assert_eq!(host.node_id, client.node_id);
        assert_eq!(host.role, LanNodeRole::Host);
        assert_eq!(host.address.as_deref(), Some("http://192.168.1.24:5400/"));
        assert!(host.project_name.unwrap().starts_with("海海"));
    }

    #[test]
    fn rejects_unusable_endpoints_and_malformed_txt() {
        let mut local = local();
        local.identity.address = "203.0.113.1:5400".parse().unwrap();
        assert!(decode(&encode(&local)).is_none());
        let mut duplicate = encode(&self::local());
        duplicate.extend_from_slice(b"\x03v=1");
        assert!(decode(&duplicate).is_none());
        assert!(decode(b"\x1fv=1").is_none());
    }

    #[test]
    #[ignore = "requires the system Bonjour daemon; confines the test service to this Mac"]
    fn bonjour_local_only_observes_registration_update_and_removal() {
        use std::time::Instant;

        let nodes = Arc::new(Mutex::new(Vec::new()));
        let (sender, receiver) = mpsc::channel();
        let directory = nodes.clone();
        let worker = std::thread::spawn(move || {
            browse_once(&receiver, &directory, &mut None, u32::MAX).unwrap();
        });
        let (advertise, advertised) = mpsc::channel();
        let publisher = std::thread::spawn(move || {
            browse_once(&advertised, &Mutex::default(), &mut None, u32::MAX).unwrap();
        });
        let mut service = local();
        service.identity.interface = u32::MAX;
        let process = std::process::id();
        service.identity.node_id = format!("{process:064x}");
        let id = service.identity.node_id.clone();
        let wait_for = |role: Option<LanNodeRole>, project: Option<&str>| {
            let deadline = Instant::now() + Duration::from_secs(8);
            loop {
                let snapshot = nodes.lock().unwrap();
                let node = snapshot.iter().find(|node| node.node_id == id);
                if node.map(|node| node.role) == role
                    && node.and_then(|node| node.project_name.as_deref()) == project
                {
                    break;
                }
                assert!(Instant::now() < deadline, "Bonjour directory: {snapshot:?}");
                drop(snapshot);
                std::thread::sleep(Duration::from_millis(30));
            }
        };
        advertise.send(Some(service.clone())).unwrap();
        wait_for(Some(LanNodeRole::Client), None);
        service.run = LanRun {
            role: Some(LanNodeRole::Creation),
            loading: false,
            project_name: Some("Essai".into()),
        };
        advertise.send(Some(service)).unwrap();
        wait_for(Some(LanNodeRole::Creation), Some("Essai"));
        advertise.send(None).unwrap();
        wait_for(None, None);
        drop(sender);
        drop(advertise);
        worker.join().unwrap();
        publisher.join().unwrap();
    }
}
