//! #174: the DNS query pipeline — performance-domain mapping synthesis,
//! ordinary forwarding with failover, and the bounded cache.
//!
//! The engine is transport-agnostic and synchronous: the callers (the
//! UDP/TCP loops in `server.rs` and the `verify` op in `control.rs`) hand
//! it one wire-format query and get one wire-format response back, so
//! every rule here is testable against real sockets without root (tests
//! bind high loopback ports; production binds UDP/TCP 53 as the
//! LaunchDaemon).
//!
//! Wire handling goes through hickory-proto exclusively — the daemon
//! never hand-parses DNS messages (ADR-0009). Raw forwarding passes the
//! client's ORIGINAL bytes upstream, which preserves EDNS0 and every flag
//! verbatim; parsing happens only at the seams that must understand the
//! message (mapping match, synthesis, cache TTLs, truncation, matching).

use hickory_proto::op::{Message, MessageType, OpCode, Query, ResponseCode};
use hickory_proto::rr::rdata::soa::SOA;
use hickory_proto::rr::rdata::A;
use hickory_proto::rr::RData;
use hickory_proto::rr::{DNSClass, Name, Record, RecordType};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream, UdpSocket};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// TTL of the synthesized mapping A record. Short on purpose: after a
/// Stop/revoke the phone's cached answer ages out in seconds, so the next
/// performance's mapping is picked up without any client-side flush
/// (spec #174: forward caches must not block a later start).
pub const MAPPING_ANSWER_TTL: u32 = 10;
/// The TTL our locally-synthesized negative answers advertise in their
/// SOA (RFC 2308: a client's negative-cache lifetime comes from the SOA;
/// a negative answer with NO SOA leaves the client to its own default —
/// field-measured on iOS at minutes, which is how a normal revoke→
/// install gap between two performances turned into "the phone never
/// connects again"). Same value as the mapping TTL: a gap self-heals
/// within seconds of the next performance's install.
pub const NEGATIVE_SOA_TTL: u32 = MAPPING_ANSWER_TTL;
/// Upper bound applied to any cached positive answer.
pub const MAX_CACHE_TTL: u32 = 300;
/// Upper bound for cached NEGATIVE outcomes (NXDOMAIN / no-answer). The
/// same "never block a later start" rule as the mapping TTL.
pub const MAX_NEGATIVE_TTL: u32 = 10;
/// Cache capacity — the daemon is a LAN forwarder, not a resolver; the
/// bound keeps memory flat no matter how noisy the LAN is.
pub const CACHE_CAPACITY: usize = 512;
/// Lease bounds accepted from `mapping.set` / `mapping.refresh` (the App
/// refreshes at a fraction of the maximum; a crashed App therefore loses
/// its mapping within the bound).
pub const MIN_LEASE: Duration = Duration::from_secs(5);
pub const MAX_LEASE: Duration = Duration::from_secs(300);
/// Per-upstream attempt timeout (UDP, and the TCP connect + exchange).
const UPSTREAM_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(2);
/// Whole-query forwarding budget across failover attempts.
const FORWARD_BUDGET: Duration = Duration::from_secs(6);

/// Which transport a query arrived on — only truncation cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Udp,
    Tcp,
}

/// Identifies the App run + session generation that owns the mapping.
/// Cross-`run_id` takeovers are accepted (the single-instance App means a
/// different run is a restart — the old holder being dead); a stale
/// generation within one run is rejected (old supervisors must not touch
/// the mapping a newer generation installed).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MappingHolder {
    pub run_id: String,
    pub generation: u64,
}

/// The active performance mapping, held under lease.
#[derive(Debug, Clone)]
pub struct ActiveMapping {
    pub domain: String,
    pub ip: Ipv4Addr,
    pub holder: MappingHolder,
    pub lease_expires_at: Instant,
}

/// Refusals `mapping_set` can produce (mirrored into the control protocol).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MappingError {
    StaleGeneration,
    InvalidDomain,
    InvalidIp,
    InvalidLease,
}

impl MappingError {
    pub fn code(&self) -> &'static str {
        match self {
            MappingError::StaleGeneration => "staleGeneration",
            MappingError::InvalidDomain => "invalidDomain",
            MappingError::InvalidIp => "invalidIp",
            MappingError::InvalidLease => "invalidLease",
        }
    }
}

/// `mapping_refresh` / `mapping_clear` from a non-holder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NotHolder;

#[derive(Clone)]
struct CacheEntry {
    /// The full upstream response as received (question included).
    wire: Vec<u8>,
    stored_at: Instant,
    /// min(record ttls) clamped to the caps above; the entry dies with it.
    ttl: Duration,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CacheKey {
    name: String,
    record_type: RecordType,
    class: DNSClass,
}

/// Counters surfaced through `status` (bounded diagnostics, no logs needed).
#[derive(Debug, Default)]
pub struct EngineStats {
    queries: AtomicU64,
    cache_hits: AtomicU64,
    forwarded: AtomicU64,
    upstream_failovers: AtomicU64,
    synthesized: AtomicU64,
    servfails: AtomicU64,
}

impl EngineStats {
    pub fn snapshot(&self) -> serde_json::Value {
        serde_json::json!({
            "queries": self.queries.load(Ordering::Relaxed),
            "cacheHits": self.cache_hits.load(Ordering::Relaxed),
            "forwarded": self.forwarded.load(Ordering::Relaxed),
            "upstreamFailovers": self.upstream_failovers.load(Ordering::Relaxed),
            "synthesized": self.synthesized.load(Ordering::Relaxed),
            "servfails": self.servfails.load(Ordering::Relaxed),
        })
    }
}

struct EngineState {
    mapping: Option<ActiveMapping>,
    /// Keep the most recent holder after revocation/expiry. A delayed
    /// mapping.set must not resurrect a retired generation when there
    /// is no active mapping left to compare against. One record only;
    /// an App restart can still take over with its new run identity.
    mapping_holder: Option<MappingHolder>,
    /// Domains ever configured as performance mappings (persisted by the
    /// daemon). While a domain is known but NOT mapped, it is answered
    /// NXDOMAIN locally — never forwarded, so a phone between performances
    /// can neither keep the old LAN address nor reach the domain's public
    /// one (spec #174: 无活跃演出时不沿用旧地址、不转发公网旧地址).
    known_domains: Vec<String>,
    cache: HashMap<CacheKey, CacheEntry>,
}

/// The query pipeline plus its mutable mapping/cache state. `clock` is
/// injected so lease tests are deterministic.
pub struct Engine {
    upstreams: Mutex<Vec<SocketAddr>>,
    state: Mutex<EngineState>,
    clock: Box<dyn Fn() -> Instant + Send + Sync>,
    pub stats: EngineStats,
}

impl Engine {
    pub fn new(
        upstreams: Vec<SocketAddr>,
        known_domains: Vec<String>,
        clock: Box<dyn Fn() -> Instant + Send + Sync>,
    ) -> Self {
        Self {
            upstreams: Mutex::new(upstreams),
            state: Mutex::new(EngineState {
                mapping: None,
                mapping_holder: None,
                known_domains,
                cache: HashMap::new(),
            }),
            clock,
            stats: EngineStats::default(),
        }
    }

    /// Live upstream replacement (`config.set`); an empty list would leave
    /// the daemon unable to forward, so the control layer rejects that
    /// before ever calling here.
    pub fn set_upstreams(&self, upstreams: Vec<SocketAddr>) {
        *self.upstreams.lock().unwrap_or_else(|e| e.into_inner()) = upstreams;
    }

    pub fn upstreams(&self) -> Vec<SocketAddr> {
        self.upstreams
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn now(&self) -> Instant {
        (self.clock)()
    }

    // ======================================================================
    // Mapping lifecycle (control plane)
    // ======================================================================

    /// Installs or replaces the performance mapping under the holder rules
    /// (see [`MappingHolder`]). Installing a domain also learns it as a
    /// known performance domain and purges the domain's cache entries, so
    /// a negative answer cached before the install cannot shadow the new
    /// A record.
    pub fn mapping_set(
        &self,
        domain: &str,
        ip: Ipv4Addr,
        holder: MappingHolder,
        lease: Duration,
    ) -> Result<(), MappingError> {
        let domain = normalize_domain(domain).ok_or(MappingError::InvalidDomain)?;
        // Canonical comparison form (trailing dot): mapping domains, known
        // domains and query names must always compare identically.
        let domain = canonical(&domain);
        if ip.is_unspecified() || ip.is_multicast() || ip.is_broadcast() {
            return Err(MappingError::InvalidIp);
        }
        if !(MIN_LEASE..=MAX_LEASE).contains(&lease) {
            return Err(MappingError::InvalidLease);
        }
        let expires_at = self.now() + lease;
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(current) = &state.mapping_holder {
            if current.run_id == holder.run_id
                && (holder.generation < current.generation
                    || (holder.generation == current.generation && state.mapping.is_none()))
            {
                // Same App run, older or retired generation: a delayed
                // install cannot replace or resurrect an ended mapping.
                return Err(MappingError::StaleGeneration);
            }
        }
        state.mapping_holder = Some(holder.clone());
        state.mapping = Some(ActiveMapping {
            domain: domain.clone(),
            ip,
            holder,
            lease_expires_at: expires_at,
        });
        if !state.known_domains.contains(&domain) {
            state.known_domains.push(domain.clone());
        }
        purge_domain_cache(&mut state.cache, &domain);
        Ok(())
    }

    /// Extends the current mapping's lease; only the holder may refresh.
    pub fn mapping_refresh(
        &self,
        holder: &MappingHolder,
        lease: Duration,
    ) -> Result<(), NotHolder> {
        if !(MIN_LEASE..=MAX_LEASE).contains(&lease) {
            return Err(NotHolder);
        }
        let expires_at = self.now() + lease;
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        match &mut state.mapping {
            Some(current) if current.holder == *holder => {
                current.lease_expires_at = expires_at;
                Ok(())
            }
            _ => Err(NotHolder),
        }
    }

    /// Removes the current mapping; only the holder may clear (a stale
    /// generation must not revoke the mapping a newer one installed). The
    /// domain stays known, so queries turn into local NXDOMAIN instead of
    /// forwarding to the public address. Cache entries for the domain are
    /// purged so the switch is immediate.
    pub fn mapping_clear(&self, holder: &MappingHolder) -> Result<bool, NotHolder> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        match &state.mapping {
            None => {
                // Clear may beat a set whose response was lost. Retire
                // its holder even if nothing has been installed yet,
                // without lowering a newer generation's watermark.
                if state.mapping_holder.as_ref().is_none_or(|current| {
                    current.run_id == holder.run_id && current.generation < holder.generation
                }) {
                    state.mapping_holder = Some(holder.clone());
                }
                Ok(false)
            }
            Some(current) if current.holder == *holder => {
                let domain = current.domain.clone();
                state.mapping = None;
                purge_domain_cache(&mut state.cache, &domain);
                Ok(true)
            }
            Some(_) => Err(NotHolder),
        }
    }

    /// Operator-level clear (disable/uninstall paths) — holder rules do
    /// not apply. Returns whether a mapping was removed.
    pub fn mapping_force_clear(&self) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        match state.mapping.take() {
            Some(active) => {
                purge_domain_cache(&mut state.cache, &active.domain);
                true
            }
            None => false,
        }
    }

    /// Lease reaper — called on a timer by the daemon. A mapping whose
    /// holder stopped refreshing (App crash, killed run) expires; the
    /// domain remains known (NXDOMAIN) and its cache is purged.
    pub fn expire_leases(&self) -> bool {
        let now = self.now();
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(active) = &state.mapping {
            if now >= active.lease_expires_at {
                let domain = active.domain.clone();
                log::info!("DNS mapping lease for {domain} expired");
                state.mapping = None;
                purge_domain_cache(&mut state.cache, &domain);
                return true;
            }
        }
        false
    }

    /// Restores the persisted known-domain set at boot (state load).
    pub fn set_known_domains(&self, domains: Vec<String>) {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .known_domains = domains;
    }

    pub fn known_domains(&self) -> Vec<String> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .known_domains
            .clone()
    }

    /// The current mapping facts for `status`: domain, ip, run id,
    /// generation, lease seconds remaining.
    pub fn mapping_snapshot(&self) -> Option<(String, Ipv4Addr, String, u64, u64)> {
        let now = self.now();
        let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.mapping.as_ref().map(|m| {
            (
                m.domain.clone(),
                m.ip,
                m.holder.run_id.clone(),
                m.holder.generation,
                m.lease_expires_at.saturating_duration_since(now).as_secs(),
            )
        })
    }

    pub fn cache_len(&self) -> usize {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .cache
            .len()
    }

    // ======================================================================
    // Query pipeline
    // ======================================================================

    /// Answers one wire-format query. Unparseable input gets FORMERR; a
    /// response (QR set) is dropped (empty vec); non-query opcodes and
    /// multi-question messages get NOTIMP — the daemon is a forwarder,
    /// nothing else.
    pub fn handle_query(&self, wire: &[u8], transport: Transport) -> Vec<u8> {
        self.stats.queries.fetch_add(1, Ordering::Relaxed);
        let query = match Message::from_vec(wire) {
            Ok(message) => message,
            Err(_) => return error_response(header_id(wire), ResponseCode::FormErr),
        };
        if query.message_type != MessageType::Query {
            return Vec::new();
        }
        if query.op_code != OpCode::Query || query.queries.len() != 1 {
            return error_from(&query, ResponseCode::NotImp);
        }
        let question = query.queries[0].clone();
        let name = canonical(&question.name().to_string());

        // Known performance domain: answer locally, authoritatively — the
        // mapping's A, an empty NOERROR for every other type (an empty
        // AAAA must never fail the valid A), NXDOMAIN when the domain is
        // known but no performance is mapped.
        let (mapped, known) = {
            let state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            match &state.mapping {
                Some(mapping) if mapping.domain == name => (Some(mapping.ip), true),
                _ => {
                    let known = state.known_domains.contains(&name);
                    (None, known)
                }
            }
        };
        if known {
            self.stats.synthesized.fetch_add(1, Ordering::Relaxed);
            return synthesize_local(&query, mapped);
        }

        // Ordinary name: bounded cache, then forward with failover.
        let key = CacheKey {
            name,
            record_type: question.query_type(),
            class: question.query_class(),
        };
        if let Some(bytes) = self.cache_serve(&key, query.id) {
            self.stats.cache_hits.fetch_add(1, Ordering::Relaxed);
            return bytes;
        }
        let upstreams = self.upstreams();
        if upstreams.is_empty() {
            self.stats.servfails.fetch_add(1, Ordering::Relaxed);
            return error_from(&query, ResponseCode::ServFail);
        }
        let deadline = self.now() + FORWARD_BUDGET;
        for (index, upstream) in upstreams.iter().enumerate() {
            if index > 0 {
                self.stats
                    .upstream_failovers
                    .fetch_add(1, Ordering::Relaxed);
            }
            let remaining = deadline.saturating_duration_since(self.now());
            if remaining.is_zero() {
                break;
            }
            let attempt_timeout = UPSTREAM_ATTEMPT_TIMEOUT.min(remaining);
            match udp_exchange(wire, *upstream, attempt_timeout) {
                Ok(response) if fake_ip_poisoned(&response) => {
                    // Not the configured upstream answering — a local
                    // TUN proxy (fake-ip mode) intercepted the daemon's
                    // query. Handing that on would route LAN phones into
                    // a reserved range that only exists inside the
                    // proxy; fail over instead (all poisoned → SERVFAIL).
                    log::warn!(
                        "upstream {upstream} answered from the RFC 2544 fake-ip range \
                         (198.18.0.0/15) — a local TUN proxy is intercepting the \
                         daemon's upstream traffic; excluding the daemon from the \
                         proxy is the operator-side fix"
                    );
                }
                Ok(response) if response_truncated(&response) => {
                    // Standard TC handling: retry the same upstream over
                    // TCP, which has no size limit.
                    match tcp_exchange(wire, *upstream, attempt_timeout) {
                        Ok(bytes) if !fake_ip_poisoned(&bytes) => {
                            return self.finish_forwarded(&query, bytes, transport)
                        }
                        Ok(_) => log::debug!("TCP retry to {upstream} poisoned/invalid"),
                        Err(e) => log::debug!("TCP retry to {upstream} failed: {e}"),
                    }
                }
                Ok(response) => return self.finish_forwarded(&query, response, transport),
                Err(e) => log::debug!("upstream {upstream} failed: {e}"),
            }
        }
        self.stats.servfails.fetch_add(1, Ordering::Relaxed);
        error_from(&query, ResponseCode::ServFail)
    }

    /// Caches the forwarded response (when cacheable) and applies UDP
    /// truncation against the client's advertised payload.
    fn finish_forwarded(
        &self,
        query: &Message,
        response: Vec<u8>,
        transport: Transport,
    ) -> Vec<u8> {
        self.stats.forwarded.fetch_add(1, Ordering::Relaxed);
        if let Ok(parsed) = Message::from_vec(&response) {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            cache_store(
                &mut state.cache,
                &query.queries[0],
                &parsed,
                &response,
                self.now(),
            );
            if transport == Transport::Udp && response.len() > query.max_payload() as usize {
                let truncated = parsed.truncate();
                return truncated.to_vec().unwrap_or(response);
            }
        }
        response
    }

    /// Serves a fresh cache hit with the client's transaction id and
    /// age-decayed TTLs; `None` on miss/expiry (an expired entry is
    /// dropped here, keeping every path bounded without a sweeper).
    fn cache_serve(&self, key: &CacheKey, client_id: u16) -> Option<Vec<u8>> {
        let now = self.now();
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        let entry = state.cache.get(key).cloned()?;
        let elapsed = now.saturating_duration_since(entry.stored_at);
        if elapsed >= entry.ttl {
            state.cache.remove(key);
            return None;
        }
        let mut message = Message::from_vec(&entry.wire).ok()?;
        message.metadata.id = client_id;
        rewrite_ttls(&mut message, elapsed.as_secs() as u32);
        message.to_vec().ok()
    }
}

// ============================================================================
// Pure helpers
// ============================================================================

/// Canonical comparison form of a domain: lowercase, exactly one trailing
/// dot. Works off Display output of hickory `Name`s and raw config strings
/// alike, so both sides normalize identically without trusting either.
pub fn canonical(domain: &str) -> String {
    format!("{}.", domain.trim_end_matches('.').to_ascii_lowercase())
}

/// Daemon-side domain validation (light by design — the App already ran
/// the full #139 domain rules; this only refuses junk reaching the socket).
pub fn normalize_domain(input: &str) -> Option<String> {
    let domain = input.trim().trim_end_matches('.').to_ascii_lowercase();
    if domain.is_empty() || domain.len() > 253 {
        return None;
    }
    if domain.parse::<std::net::IpAddr>().is_ok() {
        return None;
    }
    if domain.ends_with(".local") || domain.contains("://") || domain.contains('/') {
        return None;
    }
    let mut labels = 0;
    for label in domain.split('.') {
        labels += 1;
        if label.is_empty() || label.len() > 63 {
            return None;
        }
        if !label.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            || label.starts_with('-')
            || label.ends_with('-')
        {
            return None;
        }
    }
    if labels < 2 {
        return None;
    }
    Some(domain)
}

fn header_id(wire: &[u8]) -> u16 {
    if wire.len() >= 2 {
        u16::from_be_bytes([wire[0], wire[1]])
    } else {
        0
    }
}

/// FORMERR carrying just the transaction id (the message itself did not
/// parse far enough to echo a question).
fn error_response(id: u16, code: ResponseCode) -> Vec<u8> {
    let mut message = Message::new(id, MessageType::Response, OpCode::Query);
    message.metadata.response_code = code;
    message.to_vec().unwrap_or_default()
}

/// An error response echoing the query's question (SERVFAIL/NOTIMP).
fn error_from(query: &Message, code: ResponseCode) -> Vec<u8> {
    let mut message = query.clone().into_response();
    message.metadata.response_code = code;
    message.metadata.recursion_available = true;
    message.to_vec().unwrap_or_default()
}

fn response_truncated(response: &[u8]) -> bool {
    Message::from_vec(response)
        .map(|m| m.truncation)
        .unwrap_or(false)
}

/// RFC 2544 benchmark space — no real public resolver ever returns it.
/// Seeing it in an upstream answer means a local fake-ip TUN proxy
/// answered instead of the configured upstream; those addresses route
/// nowhere on the LAN (they only exist inside the proxy's tunnel), so
/// the answer is poison, not data. Unparseable responses are not the
/// poison check's business (the forwarder only uses parseable ones).
fn fake_ip_poisoned(response: &[u8]) -> bool {
    Message::from_vec(response)
        .map(|message| {
            message.answers.iter().any(|record| match &record.data {
                RData::A(a) => a.0.octets()[0] == 198 && (a.0.octets()[1] & 0xFE) == 18,
                _ => false,
            })
        })
        .unwrap_or(false)
}

/// The authoritative local answer for a performance domain. `Some(ip)` →
/// A queries get the LAN address (short TTL), every other type an empty
/// NOERROR (an AAAA hole must not drag the valid A down). `None` (domain
/// known, no active performance) → NXDOMAIN, also never forwarded.
///
/// Every negative-ish answer (NXDOMAIN, or an empty NOERROR for non-A
/// types) carries a synthetic SOA with [`NEGATIVE_SOA_TTL`]: without it
/// the client has no negative-cache guidance and applies its own
/// default (iOS: minutes — see the constant's doc).
fn synthesize_local(query: &Message, mapped: Option<Ipv4Addr>) -> Vec<u8> {
    let mut message = query.clone().into_response();
    message.metadata.authoritative = true;
    message.metadata.recursion_available = true;
    let name = query.queries[0].name().clone();
    if query.queries[0].query_type() == RecordType::A {
        if let Some(ip) = mapped {
            message.metadata.response_code = ResponseCode::NoError;
            message.add_answer(Record::from_rdata(
                name,
                MAPPING_ANSWER_TTL,
                RData::A(A(ip)),
            ));
            return message.to_vec().unwrap_or_default();
        }
        message.metadata.response_code = ResponseCode::NXDomain;
    } else {
        // Other types (AAAA, TXT, ...): empty NOERROR while mapped, so a
        // missing AAAA never fails the valid A; NXDOMAIN when unmapped.
        message.metadata.response_code = if mapped.is_some() {
            ResponseCode::NoError
        } else {
            ResponseCode::NXDomain
        };
    }
    message.add_authority(Record::from_rdata(
        name.clone(),
        NEGATIVE_SOA_TTL,
        RData::SOA(SOA::new(
            name.clone(),
            hostmaster_of(&name),
            1,
            3600,
            1200,
            86400,
            NEGATIVE_SOA_TTL,
        )),
    ));
    message.to_vec().unwrap_or_default()
}

/// The SOA rname for a locally-answered domain: `hostmaster.<domain>` —
/// syntactically valid, deliberately never deliverable (the daemon does
/// not receive mail; the record exists for cache timing only).
fn hostmaster_of(name: &Name) -> Name {
    Name::parse(&format!("hostmaster.{name}"), None)
        .unwrap_or_else(|_| Name::parse("hostmaster.invalid.", None).expect("static name parses"))
}

fn rewrite_ttls(message: &mut Message, decrement: u32) {
    let rewrite = |records: &mut Vec<Record>| {
        *records = records
            .iter()
            .map(|record| {
                Record::from_rdata(
                    record.name.clone(),
                    record.ttl.saturating_sub(decrement),
                    record.data.clone(),
                )
            })
            .collect();
    };
    let mut answers = std::mem::take(&mut message.answers);
    rewrite(&mut answers);
    message.insert_answers(answers);
    let mut authorities = std::mem::take(&mut message.authorities);
    rewrite(&mut authorities);
    message.insert_authorities(authorities);
    let mut additionals = std::mem::take(&mut message.additionals);
    rewrite(&mut additionals);
    message.insert_additionals(additionals);
}

/// Cache TTL policy. Negative outcomes (NXDOMAIN / zero answer records)
/// take the fixed negative cap — their SOA values are advisory here, and
/// the short bound is what keeps a later start unblocked; zero-TTL
/// positive answers are not cached at all; positive answers cache at
/// min(answer ttls) clamped to MAX_CACHE_TTL (authority/additional
/// records only ever shorten the served entry's usefulness, never extend
/// it).
fn effective_ttl(message: &Message) -> Option<Duration> {
    if message.answers.is_empty() || message.response_code == ResponseCode::NXDomain {
        return Some(Duration::from_secs(MAX_NEGATIVE_TTL as u64));
    }
    let min = message.answers.iter().map(|record| record.ttl).min()?;
    if min == 0 {
        return None;
    }
    Some(Duration::from_secs(min.min(MAX_CACHE_TTL) as u64))
}

fn cache_store(
    cache: &mut HashMap<CacheKey, CacheEntry>,
    question: &Query,
    parsed: &Message,
    wire: &[u8],
    now: Instant,
) {
    if parsed.truncation
        || !matches!(
            parsed.response_code,
            ResponseCode::NoError | ResponseCode::NXDomain
        )
    {
        return;
    }
    let Some(ttl) = effective_ttl(parsed) else {
        return;
    };
    if cache.len() >= CACHE_CAPACITY {
        // Bound: drop expired first, then the oldest-stored half. No LRU
        // churn for a LAN forwarder — deterministic and O(n) only on the
        // rare overflow.
        cache.retain(|_, entry| now.saturating_duration_since(entry.stored_at) < entry.ttl);
        if cache.len() >= CACHE_CAPACITY {
            let mut stored: Vec<(Instant, CacheKey)> = cache
                .iter()
                .map(|(key, entry)| (entry.stored_at, key.clone()))
                .collect();
            stored.sort_by_key(|(stored_at, _)| *stored_at);
            let drop_count = stored.len() - CACHE_CAPACITY / 2;
            for (_, key) in stored.into_iter().take(drop_count) {
                cache.remove(&key);
            }
        }
    }
    let key = CacheKey {
        name: canonical(&question.name().to_string()),
        record_type: question.query_type(),
        class: question.query_class(),
    };
    cache.insert(
        key,
        CacheEntry {
            wire: wire.to_vec(),
            stored_at: now,
            ttl,
        },
    );
}

/// Drops cache entries whose QNAME is the domain or a subdomain of it —
/// used when a mapping is installed (clear a previously cached NXDOMAIN)
/// and when it is removed or expires (clear the short-lived A answers).
fn purge_domain_cache(cache: &mut HashMap<CacheKey, CacheEntry>, domain: &str) {
    let suffix = canonical(domain);
    cache.retain(|key, _| !key.name.ends_with(&suffix));
}

/// The response must echo the query's transaction id AND question.
fn question_matches(response: &Message, query: &Message) -> bool {
    response.id == query.id
        && response.queries.len() == 1
        && response.queries[0].name() == query.queries[0].name()
        && response.queries[0].query_type() == query.queries[0].query_type()
        && response.queries[0].query_class() == query.queries[0].query_class()
}

// ============================================================================
// Upstream exchange
// ============================================================================

fn udp_exchange(wire: &[u8], upstream: SocketAddr, timeout: Duration) -> Result<Vec<u8>, String> {
    let bind: &str = if upstream.is_ipv4() {
        "0.0.0.0:0"
    } else {
        "[::]:0"
    };
    let socket = UdpSocket::bind(bind).map_err(|e| format!("bind: {e}"))?;
    socket
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("timeout: {e}"))?;
    socket
        .send_to(wire, upstream)
        .map_err(|e| format!("send: {e}"))?;
    let deadline = Instant::now() + timeout;
    let mut buffer = [0u8; 65535];
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("upstream timeout".to_string());
        }
        socket
            .set_read_timeout(Some(remaining))
            .map_err(|e| format!("timeout: {e}"))?;
        match socket.recv_from(&mut buffer) {
            Ok((size, from)) if from == upstream => {
                let response = &buffer[..size];
                // A stray datagram (mismatched transaction id) is ignored;
                // a wrong question is an upstream bug — fail the attempt.
                if response.len() >= 2 && response[..2] == *wire.get(..2).unwrap_or(&[0, 0]) {
                    let parsed = Message::from_vec(response)
                        .map_err(|e| format!("upstream response unparseable: {e}"))?;
                    let query = Message::from_vec(wire).map_err(|e| format!("query: {e}"))?;
                    if !question_matches(&parsed, &query) {
                        return Err("upstream response did not match the query".to_string());
                    }
                    return Ok(response.to_vec());
                }
            }
            Ok(_) => continue, // answer from a different address — ignore
            Err(e) => return Err(format!("recv: {e}")),
        }
    }
}

fn tcp_exchange(wire: &[u8], upstream: SocketAddr, timeout: Duration) -> Result<Vec<u8>, String> {
    let mut stream =
        TcpStream::connect_timeout(&upstream, timeout).map_err(|e| format!("connect: {e}"))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("timeout: {e}"))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("timeout: {e}"))?;
    let mut framed = Vec::with_capacity(wire.len() + 2);
    framed.extend_from_slice(&(wire.len() as u16).to_be_bytes());
    framed.extend_from_slice(wire);
    stream
        .write_all(&framed)
        .map_err(|e| format!("send: {e}"))?;
    let mut length = [0u8; 2];
    stream
        .read_exact(&mut length)
        .map_err(|e| format!("recv length: {e}"))?;
    let mut response = vec![0u8; u16::from_be_bytes(length) as usize];
    stream
        .read_exact(&mut response)
        .map_err(|e| format!("recv body: {e}"))?;
    let parsed = Message::from_vec(&response).map_err(|e| format!("response unparseable: {e}"))?;
    let query = Message::from_vec(wire).map_err(|e| format!("query: {e}"))?;
    if !question_matches(&parsed, &query) {
        return Err("upstream response did not match the query".to_string());
    }
    Ok(response)
}

// ============================================================================
// Tests — real sockets on loopback high ports, no root, no mocks of the
// DNS layer itself (upstreams are real UDP/TCP servers the tests spawn).
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use hickory_proto::op::Edns;
    use hickory_proto::rr::rdata::{A, AAAA, TXT};
    use hickory_proto::rr::Name;
    use std::net::TcpListener;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn engine(upstreams: Vec<SocketAddr>) -> Engine {
        Engine::new(upstreams, Vec::new(), Box::new(Instant::now))
    }

    fn query_wire(name: &str, record_type: RecordType, id: u16) -> Vec<u8> {
        let mut message = Message::query();
        message.metadata.id = id;
        message.metadata.recursion_desired = true;
        message.add_query(Query::query(Name::from_utf8(name).unwrap(), record_type));
        message.to_vec().unwrap()
    }

    fn parse(wire: &[u8]) -> Message {
        Message::from_vec(wire).unwrap()
    }

    fn holder(generation: u64) -> MappingHolder {
        MappingHolder {
            run_id: "run-a".to_string(),
            generation,
        }
    }

    /// A real UDP upstream answering every A query with 192.0.2.7 and
    /// every AAAA with 2001:db8::7, after an optional artificial delay.
    fn spawn_udp_upstream(delay: Option<Duration>) -> (SocketAddr, Arc<AtomicBool>) {
        let socket = Arc::new(UdpSocket::bind(("127.0.0.1", 0)).unwrap());
        let addr = socket.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                if stop_flag.load(Ordering::Relaxed) {
                    return;
                }
                socket
                    .set_read_timeout(Some(Duration::from_millis(100)))
                    .ok();
                let Ok((size, from)) = socket.recv_from(&mut buffer) else {
                    continue;
                };
                if let Some(delay) = delay {
                    std::thread::sleep(delay);
                }
                let Ok(query) = Message::from_vec(&buffer[..size]) else {
                    continue;
                };
                let mut response = query.clone().into_response();
                response.metadata.response_code = ResponseCode::NoError;
                response.metadata.recursion_available = true;
                let name = query.queries[0].name().clone();
                if query.queries[0].query_type() == RecordType::A {
                    response.add_answer(Record::from_rdata(
                        name,
                        120,
                        RData::A(A("192.0.2.7".parse().unwrap())),
                    ));
                } else if query.queries[0].query_type() == RecordType::AAAA {
                    response.add_answer(Record::from_rdata(
                        name,
                        120,
                        RData::AAAA(AAAA("2001:db8::7".parse().unwrap())),
                    ));
                }
                socket.send_to(&response.to_vec().unwrap(), from).ok();
            }
        });
        (addr, stop)
    }

    /// A "poisoned" upstream: answers A queries from the RFC 2544
    /// fake-ip range — exactly what a local fake-ip TUN proxy returns
    /// when it intercepts the daemon's upstream traffic.
    fn spawn_fake_ip_upstream() -> (SocketAddr, Arc<AtomicBool>) {
        let socket = Arc::new(UdpSocket::bind(("127.0.0.1", 0)).unwrap());
        let addr = socket.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                if stop_flag.load(Ordering::Relaxed) {
                    return;
                }
                socket
                    .set_read_timeout(Some(Duration::from_millis(100)))
                    .ok();
                let Ok((size, from)) = socket.recv_from(&mut buffer) else {
                    continue;
                };
                let Ok(query) = Message::from_vec(&buffer[..size]) else {
                    continue;
                };
                let mut response = query.clone().into_response();
                response.metadata.response_code = ResponseCode::NoError;
                let name = query.queries[0].name().clone();
                if query.queries[0].query_type() == RecordType::A {
                    response.add_answer(Record::from_rdata(
                        name,
                        120,
                        RData::A(A("198.18.2.215".parse().unwrap())),
                    ));
                    socket.send_to(&response.to_vec().unwrap(), from).ok();
                }
            }
        });
        (addr, stop)
    }

    #[test]
    fn nxdomain_for_known_domains_carries_a_short_soa() {
        // RFC 2308: a client's negative-cache lifetime comes from the
        // SOA. A negative answer with NO SOA leaves iOS to its own
        // default (minutes) — field-measured as "the phone never
        // connects again" across a normal revoke→install gap.
        let (upstream, stop) = spawn_udp_upstream(None);
        let engine = engine(vec![upstream]);
        engine
            .mapping_set(
                "show.example.org",
                "192.168.11.31".parse().unwrap(),
                holder(1),
                Duration::from_secs(60),
            )
            .unwrap();
        engine.mapping_clear(&holder(1)).unwrap();

        let answer = parse(&engine.handle_query(
            &query_wire("show.example.org", RecordType::A, 21),
            Transport::Udp,
        ));

        assert_eq!(answer.response_code, ResponseCode::NXDomain);
        assert_eq!(answer.authorities.len(), 1);
        let soa_record = &answer.authorities[0];
        assert_eq!(soa_record.ttl, NEGATIVE_SOA_TTL);
        match &soa_record.data {
            RData::SOA(soa) => {
                assert_eq!(soa.minimum, NEGATIVE_SOA_TTL);
                // The query name (an FQDN — trailing dot) is the SOA's mname.
                assert_eq!(soa.mname, Name::from_utf8("show.example.org.").unwrap());
            }
            other => panic!("expected SOA in authority, got {other:?}"),
        }
        stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn empty_non_a_answers_carry_the_soa_too() {
        // A mapped domain's empty AAAA answer is also negatively
        // cacheable by the client — it must carry the same short SOA.
        let (upstream, stop) = spawn_udp_upstream(None);
        let engine = engine(vec![upstream]);
        engine
            .mapping_set(
                "show.example.org",
                "192.168.11.31".parse().unwrap(),
                holder(1),
                Duration::from_secs(60),
            )
            .unwrap();

        let answer = parse(&engine.handle_query(
            &query_wire("show.example.org", RecordType::AAAA, 22),
            Transport::Udp,
        ));

        assert_eq!(answer.response_code, ResponseCode::NoError);
        assert_eq!(answer.answers.len(), 0);
        assert_eq!(answer.authorities.len(), 1);
        assert_eq!(answer.authorities[0].ttl, NEGATIVE_SOA_TTL);
        stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn fake_ip_upstream_answers_are_rejected_not_relayed() {
        // A single poisoned upstream (a local fake-ip TUN proxy
        // answering instead of the real resolver): the daemon refuses
        // to relay reserved-range addresses to the LAN and fails over;
        // with nothing left, the honest answer is SERVFAIL.
        let (poisoned, stop) = spawn_fake_ip_upstream();
        let poisoned_engine = engine(vec![poisoned]);
        let parsed = parse(&poisoned_engine.handle_query(
            &query_wire("ordinary.example.org", RecordType::A, 23),
            Transport::Udp,
        ));
        assert_eq!(parsed.response_code, ResponseCode::ServFail);
        assert_eq!(parsed.answers.len(), 0);
        stop.store(true, Ordering::Relaxed);

        // Failover: a healthy upstream after the poisoned one answers.
        let (poisoned2, stop2) = spawn_fake_ip_upstream();
        let (healthy, stop3) = spawn_udp_upstream(None);
        let failover_engine = engine(vec![poisoned2, healthy]);
        let parsed = parse(&failover_engine.handle_query(
            &query_wire("ordinary.example.org", RecordType::A, 24),
            Transport::Udp,
        ));
        assert_eq!(parsed.response_code, ResponseCode::NoError);
        assert_eq!(parsed.answers.len(), 1);
        assert!(
            failover_engine
                .stats
                .upstream_failovers
                .load(Ordering::Relaxed)
                >= 1
        );
        stop2.store(true, Ordering::Relaxed);
        stop3.store(true, Ordering::Relaxed);
    }

    #[test]
    fn normalize_domain_accepts_and_rejects() {
        assert_eq!(
            normalize_domain("Show.Example.Org."),
            Some("show.example.org".to_string())
        );
        assert_eq!(
            normalize_domain("example.org"),
            Some("example.org".to_string())
        );
        assert_eq!(normalize_domain("192.168.1.5"), None);
        assert_eq!(normalize_domain("show.local"), None);
        assert_eq!(normalize_domain("https://example.org"), None);
        assert_eq!(normalize_domain("org"), None);
        assert_eq!(normalize_domain("-bad.example.org"), None);
        assert_eq!(normalize_domain("bad-.example.org"), None);
        assert_eq!(normalize_domain("bad..example.org"), None);
        assert_eq!(normalize_domain(""), None);
    }

    #[test]
    fn unparseable_wire_gets_formerr() {
        let response = engine(vec![]).handle_query(&[0xab, 0xcd, 0xff], Transport::Udp);
        let parsed = parse(&response);
        assert_eq!(parsed.id, 0xabcd);
        assert_eq!(parsed.response_code, ResponseCode::FormErr);
    }

    #[test]
    fn responses_are_dropped_and_other_opcodes_get_notimp() {
        let engine = engine(vec![]);
        let response = Message::new(1, MessageType::Response, OpCode::Query);
        let wire = response.to_vec().unwrap();
        assert!(engine.handle_query(&wire, Transport::Udp).is_empty());

        let status = Message::new(2, MessageType::Query, OpCode::Status);
        let wire = status.to_vec().unwrap();
        let parsed = parse(&engine.handle_query(&wire, Transport::Udp));
        assert_eq!(parsed.response_code, ResponseCode::NotImp);
    }

    #[test]
    fn mapped_domain_answers_a_and_empty_aaaa() {
        let engine = engine(vec![]);
        engine
            .mapping_set(
                "show.example.org",
                "192.168.11.31".parse().unwrap(),
                holder(1),
                Duration::from_secs(60),
            )
            .unwrap();
        let a = parse(&engine.handle_query(
            &query_wire("show.example.org", RecordType::A, 7),
            Transport::Udp,
        ));
        assert_eq!(a.response_code, ResponseCode::NoError);
        assert!(a.authoritative);
        assert_eq!(a.answers.len(), 1);
        assert_eq!(a.answers[0].ttl, MAPPING_ANSWER_TTL);
        match &a.answers[0].data {
            RData::A(address) => assert_eq!(address.0.to_string(), "192.168.11.31"),
            other => panic!("expected A, got {other:?}"),
        }
        // AAAA has no record but must not fail — NOERROR, empty (the
        // valid A stays usable; spec #174).
        let aaaa = parse(&engine.handle_query(
            &query_wire("SHOW.EXAMPLE.ORG.", RecordType::AAAA, 8),
            Transport::Udp,
        ));
        assert_eq!(aaaa.response_code, ResponseCode::NoError);
        assert!(aaaa.answers.is_empty());
    }

    #[test]
    fn known_domain_without_mapping_is_nxdomain_not_forwarded() {
        let (upstream, stop) = spawn_udp_upstream(None);
        let engine = engine(vec![upstream]);
        engine
            .mapping_set(
                "show.example.org",
                "192.168.11.31".parse().unwrap(),
                holder(1),
                Duration::from_secs(60),
            )
            .unwrap();
        engine.mapping_clear(&holder(1)).unwrap();
        let answer = parse(&engine.handle_query(
            &query_wire("show.example.org", RecordType::A, 9),
            Transport::Udp,
        ));
        assert_eq!(answer.response_code, ResponseCode::NXDomain);
        assert_eq!(engine.stats.forwarded.load(Ordering::Relaxed), 0);
        stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn revoked_generation_cannot_reinstall_after_clear() {
        let engine = engine(vec![]);
        let ip = "192.168.11.31".parse().unwrap();
        engine
            .mapping_set("show.example.org", ip, holder(2), MAX_LEASE)
            .unwrap();
        engine.mapping_clear(&holder(2)).unwrap();
        for generation in [1, 2] {
            assert_eq!(
                engine.mapping_set("show.example.org", ip, holder(generation), MAX_LEASE),
                Err(MappingError::StaleGeneration)
            );
        }
        engine
            .mapping_set("show.example.org", ip, holder(3), MAX_LEASE)
            .unwrap();
        assert!(engine.mapping_clear(&holder(2)).is_err());
        assert_eq!(engine.mapping_snapshot().unwrap().3, 3);
    }

    #[test]
    fn clear_before_install_retires_only_that_generation() {
        let engine = engine(vec![]);
        let ip = "192.168.11.31".parse().unwrap();
        assert_eq!(engine.mapping_clear(&holder(3)), Ok(false));
        assert_eq!(engine.mapping_clear(&holder(2)), Ok(false));
        assert_eq!(
            engine.mapping_set("show.example.org", ip, holder(3), MAX_LEASE),
            Err(MappingError::StaleGeneration)
        );
        engine
            .mapping_set("show.example.org", ip, holder(4), MAX_LEASE)
            .unwrap();
        engine.mapping_clear(&holder(4)).unwrap();
        let restarted = MappingHolder {
            run_id: "new-app-run".to_string(),
            generation: 1,
        };
        engine
            .mapping_set("show.example.org", ip, restarted, MAX_LEASE)
            .unwrap();
    }

    #[test]
    fn mapping_holder_rules_guard_the_lifecycle() {
        let engine = engine(vec![]);
        let ip = "192.168.11.31".parse().unwrap();
        // Stale generation of the same run is rejected.
        engine
            .mapping_set("show.example.org", ip, holder(2), Duration::from_secs(60))
            .unwrap();
        assert_eq!(
            engine
                .mapping_set("show.example.org", ip, holder(1), Duration::from_secs(60))
                .err(),
            Some(MappingError::StaleGeneration)
        );
        // Same generation re-install is an idempotent replace.
        engine
            .mapping_set("show.example.org", ip, holder(2), Duration::from_secs(60))
            .unwrap();
        // Newer generation of the same run replaces.
        engine
            .mapping_set("next.example.org", ip, holder(3), Duration::from_secs(60))
            .unwrap();
        assert_eq!(engine.mapping_snapshot().unwrap().0, "next.example.org.");
        // A different run takes over (the App restarted); the old run can
        // neither refresh nor clear the new mapping.
        let restarted = MappingHolder {
            run_id: "run-b".to_string(),
            generation: 1,
        };
        engine
            .mapping_set(
                "show.example.org",
                ip,
                restarted.clone(),
                Duration::from_secs(60),
            )
            .unwrap();
        assert_eq!(
            engine
                .mapping_refresh(&holder(3), Duration::from_secs(60))
                .err(),
            Some(NotHolder)
        );
        assert_eq!(engine.mapping_clear(&holder(3)).err(), Some(NotHolder));
        // The new holder clears cleanly (second clear is a false no-op).
        assert!(engine.mapping_clear(&restarted).unwrap());
        assert!(!engine.mapping_clear(&restarted).unwrap());
        // A new performance after revocation uses a new generation.
        // Operator-level clear works regardless of holders.
        let restarted = MappingHolder {
            generation: 2,
            ..restarted
        };
        engine
            .mapping_set("show.example.org", ip, restarted, Duration::from_secs(60))
            .unwrap();
        assert!(engine.mapping_force_clear());
    }

    #[test]
    fn invalid_mapping_input_is_refused() {
        let engine = engine(vec![]);
        let ip = "192.168.11.31".parse().unwrap();
        assert_eq!(
            engine
                .mapping_set("bad_local", ip, holder(1), Duration::from_secs(60))
                .err(),
            Some(MappingError::InvalidDomain)
        );
        assert_eq!(
            engine
                .mapping_set(
                    "show.example.org",
                    "0.0.0.0".parse().unwrap(),
                    holder(1),
                    Duration::from_secs(60)
                )
                .err(),
            Some(MappingError::InvalidIp)
        );
        assert_eq!(
            engine
                .mapping_set("show.example.org", ip, holder(1), Duration::from_secs(2))
                .err(),
            Some(MappingError::InvalidLease)
        );
        assert_eq!(
            engine
                .mapping_set("show.example.org", ip, holder(1), Duration::from_secs(301))
                .err(),
            Some(MappingError::InvalidLease)
        );
    }

    #[test]
    fn lease_expiry_releases_mapping_but_keeps_domain_known() {
        let engine = engine(vec![]);
        let ip = "192.168.11.31".parse().unwrap();
        engine
            .mapping_set("show.example.org", ip, holder(1), MIN_LEASE)
            .unwrap();
        assert!(!engine.expire_leases());
        // An advancing clock shows the sweep: mapping_set observes T0,
        // the reaper T0 + 60s — the 5s lease is long past. The mapping is
        // gone, the domain stays known, queries turn NXDOMAIN.
        let start = Instant::now();
        let ticks = Arc::new(AtomicU64::new(0));
        let tick_count = Arc::clone(&ticks);
        let clocked = Engine::new(
            vec![],
            vec![],
            Box::new(move || {
                start + Duration::from_secs(60 * tick_count.fetch_add(1, Ordering::Relaxed))
            }),
        );
        clocked
            .mapping_set("show.example.org", ip, holder(1), MIN_LEASE)
            .unwrap();
        assert!(clocked.expire_leases());
        let answer = parse(&clocked.handle_query(
            &query_wire("show.example.org", RecordType::A, 3),
            Transport::Udp,
        ));
        assert_eq!(answer.response_code, ResponseCode::NXDomain);
    }

    #[test]
    fn forwards_ordinary_a_and_aaaa_over_real_udp() {
        let (upstream, stop) = spawn_udp_upstream(None);
        let engine = engine(vec![upstream]);
        for record_type in [RecordType::A, RecordType::AAAA] {
            let answer = parse(&engine.handle_query(
                &query_wire("ordinary.example.org", record_type, 11),
                Transport::Udp,
            ));
            assert_eq!(answer.response_code, ResponseCode::NoError);
            assert_eq!(answer.answers.len(), 1);
        }
        stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn upstream_failover_skips_a_dead_first_upstream() {
        // Bound an address, then drop the socket: the port goes silent —
        // exactly a hung upstream (timeout path, not connection refused).
        let dead = {
            let socket = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
            socket.local_addr().unwrap()
        };
        let (alive, stop) = spawn_udp_upstream(None);
        let engine = engine(vec![dead, alive]);
        let parsed = parse(&engine.handle_query(
            &query_wire("ordinary.example.org", RecordType::A, 12),
            Transport::Udp,
        ));
        assert_eq!(parsed.response_code, ResponseCode::NoError);
        assert_eq!(parsed.answers.len(), 1);
        assert!(engine.stats.upstream_failovers.load(Ordering::Relaxed) >= 1);
        stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn all_upstreams_dead_answers_servfail() {
        // Bound-but-silent upstream: the whole budget is spent failing over.
        let dead = {
            let socket = UdpSocket::bind(("127.0.0.1", 0)).unwrap();
            socket.local_addr().unwrap()
        };
        let engine = engine(vec![dead]);
        let started = Instant::now();
        let parsed = parse(&engine.handle_query(
            &query_wire("ordinary.example.org", RecordType::A, 13),
            Transport::Udp,
        ));
        assert_eq!(parsed.response_code, ResponseCode::ServFail);
        assert_eq!(parsed.queries.len(), 1);
        assert!(started.elapsed() < FORWARD_BUDGET + Duration::from_secs(2));
    }

    #[test]
    fn cache_serves_hits_with_fresh_ids_and_decaying_ttls() {
        let (upstream, stop) = spawn_udp_upstream(None);
        let engine = engine(vec![upstream]);
        let first = parse(&engine.handle_query(
            &query_wire("cached.example.org", RecordType::A, 21),
            Transport::Udp,
        ));
        assert_eq!(engine.stats.forwarded.load(Ordering::Relaxed), 1);
        // Different id, same question: served from cache, no second hit.
        let second = parse(&engine.handle_query(
            &query_wire("cached.example.org", RecordType::A, 22),
            Transport::Udp,
        ));
        assert_eq!(second.id, 22);
        assert_eq!(engine.stats.forwarded.load(Ordering::Relaxed), 1);
        assert_eq!(engine.stats.cache_hits.load(Ordering::Relaxed), 1);
        assert_eq!(second.answers.len(), 1);
        // Same instant → same TTL as the first answer.
        assert_eq!(second.answers[0].ttl, first.answers[0].ttl);
        stop.store(true, Ordering::Relaxed);
    }

    #[test]
    fn installing_a_mapping_purges_a_stale_negative_entry() {
        // The MX type gets an empty NOERROR from the A/AAAA upstream —
        // cached as a negative answer; then the domain becomes known and
        // the mapping must win over the cached negative.
        let (upstream, stop) = spawn_udp_upstream(None);
        let engine = engine(vec![upstream]);
        let before = parse(&engine.handle_query(
            &query_wire("show.example.org", RecordType::MX, 41),
            Transport::Udp,
        ));
        assert_eq!(before.response_code, ResponseCode::NoError);
        assert_eq!(engine.cache_len(), 1);
        // Install: the domain becomes known and its cache entries vanish.
        engine
            .mapping_set(
                "show.example.org",
                "192.168.11.31".parse().unwrap(),
                holder(1),
                Duration::from_secs(60),
            )
            .unwrap();
        assert_eq!(engine.cache_len(), 0);
        let mapped = parse(&engine.handle_query(
            &query_wire("show.example.org", RecordType::A, 42),
            Transport::Udp,
        ));
        assert_eq!(mapped.response_code, ResponseCode::NoError);
        assert_eq!(mapped.answers.len(), 1);
        stop.store(true, Ordering::Relaxed);
    }

    /// One upstream, two transports on the SAME port number: UDP answers
    /// every query with TC=1 (the standard "retry over TCP" signal), TCP
    /// delivers the full oversized answer. The daemon must complete the
    /// fallback and return the whole record.
    #[test]
    fn truncated_udp_answers_fall_back_to_tcp_upstream() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let udp = Arc::new(UdpSocket::bind(("127.0.0.1", port)).unwrap());
        let upstream = SocketAddr::from(([127, 0, 0, 1], port));

        let stop = Arc::new(AtomicBool::new(false));
        let stop_udp = Arc::clone(&stop);
        let udp_socket = Arc::clone(&udp);
        std::thread::spawn(move || {
            let mut buffer = [0u8; 4096];
            loop {
                if stop_udp.load(Ordering::Relaxed) {
                    return;
                }
                udp_socket
                    .set_read_timeout(Some(Duration::from_millis(100)))
                    .ok();
                let Ok((size, from)) = udp_socket.recv_from(&mut buffer) else {
                    continue;
                };
                let Ok(query) = Message::from_vec(&buffer[..size]) else {
                    continue;
                };
                let mut response = query.into_response();
                response.metadata.response_code = ResponseCode::NoError;
                response.metadata.truncation = true;
                udp_socket.send_to(&response.to_vec().unwrap(), from).ok();
            }
        });
        let stop_tcp = Arc::clone(&stop);
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                if stop_tcp.load(Ordering::Relaxed) {
                    return;
                }
                let Ok(mut stream) = stream else { return };
                let mut length = [0u8; 2];
                if stream.read_exact(&mut length).is_err() {
                    return;
                }
                let mut query = vec![0u8; u16::from_be_bytes(length) as usize];
                if stream.read_exact(&mut query).is_err() {
                    return;
                }
                let Ok(parsed) = Message::from_vec(&query) else {
                    return;
                };
                let mut response = parsed.clone().into_response();
                response.metadata.response_code = ResponseCode::NoError;
                let name = parsed.queries[0].name().clone();
                response.add_answer(Record::from_rdata(
                    name,
                    60,
                    RData::TXT(TXT::new(vec!["y".repeat(200); 3])),
                ));
                let body = response.to_vec().unwrap();
                let mut framed = (body.len() as u16).to_be_bytes().to_vec();
                framed.extend_from_slice(&body);
                stream.write_all(&framed).ok();
            }
        });

        let engine = engine(vec![upstream]);
        // The client advertises a 4096-byte UDP payload (EDNS0): the 600+
        // byte TCP answer fits it, so the daemon must forward it intact.
        let mut query = Message::query();
        query.metadata.id = 61;
        query.metadata.recursion_desired = true;
        query.add_query(Query::query(
            Name::from_utf8("big.example.org").unwrap(),
            RecordType::TXT,
        ));
        let mut edns = Edns::new();
        edns.set_max_payload(4096);
        query.set_edns(edns);
        let answer = parse(&engine.handle_query(&query.to_vec().unwrap(), Transport::Udp));
        assert_eq!(answer.response_code, ResponseCode::NoError);
        assert!(!answer.truncation);
        assert_eq!(answer.answers.len(), 1);
        stop.store(true, Ordering::Relaxed);
    }

    /// UDP answers bigger than the client's advertised payload come back
    /// TC-truncated (question only); the same query over TCP is complete.
    #[test]
    fn oversized_udp_answers_are_truncated_to_the_client_payload() {
        let (upstream, stop) = spawn_oversized_udp_upstream();
        let engine = engine(vec![upstream]);
        let wire = query_wire("big.example.org", RecordType::TXT, 71);
        let over_udp = parse(&engine.handle_query(&wire, Transport::Udp));
        assert!(over_udp.truncation);
        assert!(over_udp.answers.is_empty());
        let over_tcp = parse(&engine.handle_query(&wire, Transport::Tcp));
        assert!(!over_tcp.truncation);
        assert_eq!(over_tcp.answers.len(), 1);
        stop.store(true, Ordering::Relaxed);
    }

    /// A UDP upstream that always answers with an oversized TXT record.
    fn spawn_oversized_udp_upstream() -> (SocketAddr, Arc<AtomicBool>) {
        let socket = Arc::new(UdpSocket::bind(("127.0.0.1", 0)).unwrap());
        let addr = socket.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);
        std::thread::spawn(move || {
            let mut buffer = [0u8; 8192];
            loop {
                if stop_flag.load(Ordering::Relaxed) {
                    return;
                }
                socket
                    .set_read_timeout(Some(Duration::from_millis(100)))
                    .ok();
                let Ok((size, from)) = socket.recv_from(&mut buffer) else {
                    continue;
                };
                let Ok(query) = Message::from_vec(&buffer[..size]) else {
                    continue;
                };
                let mut response = query.clone().into_response();
                response.metadata.response_code = ResponseCode::NoError;
                let name = query.queries[0].name().clone();
                response.add_answer(Record::from_rdata(
                    name,
                    60,
                    RData::TXT(TXT::new(vec!["y".repeat(200); 3])),
                ));
                socket.send_to(&response.to_vec().unwrap(), from).ok();
            }
        });
        (addr, stop)
    }

    #[test]
    fn cache_capacity_stays_bounded() {
        let mut cache = HashMap::new();
        for i in 0..(CACHE_CAPACITY + 100) {
            let name = Name::from_utf8(format!("host-{i}.example.org")).unwrap();
            let mut response = Message::new(1, MessageType::Response, OpCode::Query);
            response.metadata.response_code = ResponseCode::NoError;
            response.add_answer(Record::from_rdata(
                name.clone(),
                60,
                RData::A(A("192.0.2.1".parse().unwrap())),
            ));
            let wire = response.to_vec().unwrap();
            let question = Query::query(name, RecordType::A);
            cache_store(
                &mut cache,
                &question,
                &Message::from_vec(&wire).unwrap(),
                &wire,
                Instant::now(),
            );
            // The bound held on every insert; the drop-oldest-half
            // strategy lands anywhere above the half, never above the cap.
            assert!(!cache.is_empty());
            assert!(cache.len() <= CACHE_CAPACITY);
        }
        assert!(!cache.is_empty());
        assert!(cache.len() <= CACHE_CAPACITY);
    }

    #[test]
    fn query_matching_rejects_mismatched_responses() {
        let query = parse(&query_wire("a.example.org", RecordType::A, 1));
        let other = parse(&query_wire("b.example.org", RecordType::A, 1));
        assert!(!question_matches(&other, &query));
        let same = parse(&query_wire("a.example.org", RecordType::A, 1));
        assert!(question_matches(&same, &query));
        let wrong_type = parse(&query_wire("a.example.org", RecordType::AAAA, 1));
        assert!(!question_matches(&wrong_type, &query));
    }

    #[test]
    fn canonical_normalizes_case_and_dots() {
        assert_eq!(canonical("Show.Example.ORG"), "show.example.org.");
        assert_eq!(canonical("show.example.org."), "show.example.org.");
        assert_eq!(canonical("SHOW.EXAMPLE.ORG.."), "show.example.org.");
    }
}
