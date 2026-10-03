//! #139: Host-side trusted-HTTPS certificate material — validation,
//! protected storage and the summary the settings「可信 HTTPS」section
//! renders. The App-posed boundary (parent #137): a real public-CA
//! certificate for a real DNS domain, imported by the operator, validated
//! before anything is committed, kept out of preferences/manifests/logs
//! and restored across launches. The TLS gateway that SERVES this
//! material belongs to a later patch (#140) — this module never listens.
//!
//! Layering: pure functions parameterized by directory, anchors and
//! clock (testable with tempdirs and rcgen-generated chains); the
//! commands in `commands/https.rs` are thin AppHandle wrappers.
//! Operator-facing preparation guide: docs/zh-CN/reference/https.md
//! (en tree mirror); contract frame: runtime-contract.md §15.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use ::time::{format_description::well_known::Rfc3339, OffsetDateTime};
use rustls_pemfile::{certs, private_key};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use specta::Type;
use webpki::types::{CertificateDer, PrivateKeyDer, TrustAnchor, UnixTime};
use x509_parser::prelude::*;

/// The reminder lead time folded into [`HttpsCertificateStatus::ExpiringSoon`].
/// A display policy, not an assumption about certificate lifetime — the
/// actual `not_after` always rides the summary.
pub const EXPIRY_REMINDER_DAYS: i64 = 30;

/// Where material lives under the app data dir — `https/material.pem`,
/// one file so replacement is a single atomic rename (no half-replaced
/// cert/key pair can ever exist).
pub const MATERIAL_DIR_NAME: &str = "https";
pub const MATERIAL_FILE_NAME: &str = "material.pem";

/// The project health route both the session's health polling and the
/// #140 entry probe speak (runtime-contract §5) — one constant so the
/// tunnel and the internal check can never drift onto different paths.
pub const HEALTH_PATH: &str = "/__pnds/health";

/// The production anchor set (Mozilla roots via webpki-roots). Tests
/// inject rcgen-generated anchors instead.
pub fn public_trust_anchors() -> &'static [TrustAnchor<'static>] {
    webpki_roots::TLS_SERVER_ROOTS
}

// ============================================================================
// Wire types (tauri-specta)
// ============================================================================

/// Why imported material (or stored material at reload) is not usable.
/// `code` keys the localized UI message; `detail` is the English
/// specifics (dates, SANs, paths) shown alongside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum HttpsProblemCode {
    /// A file is not PEM-decodable certificate / private-key material,
    /// or parts of the pair are missing.
    Parse,
    /// The leaf's validity window ended before `now`.
    Expired,
    /// The leaf's validity window starts after `now`.
    NotYetValid,
    /// The configured domain is not covered by the leaf's SANs.
    DomainMismatch,
    /// The chain cannot reach a trust anchor because an intermediate is
    /// missing from the imported material.
    IncompleteChain,
    /// The chain resolves structurally but its root is not a publicly
    /// trusted CA (self-signed or private CA — phones will not trust it).
    NotPubliclyTrusted,
    /// The private key does not match the leaf certificate's public key.
    KeyMismatch,
    /// Writing the protected storage failed.
    Storage,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpsProblem {
    pub code: HttpsProblemCode,
    pub detail: String,
}

impl HttpsProblem {
    fn new(code: HttpsProblemCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

/// The certificate's standing at the moment of the check. Reload maps
/// revalidation failures into the matching variants; import only ever
/// produces `Valid` / `ExpiringSoon` (anything else was refused).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum HttpsCertificateStatus {
    /// Valid now, beyond the reminder window.
    Valid,
    /// Valid now but expiring within [`EXPIRY_REMINDER_DAYS`] — renew
    /// before the next performance.
    ExpiringSoon,
    Expired,
    NotYetValid,
    /// The stored leaf no longer covers the currently configured domain
    /// (the operator changed the domain after import).
    WrongDomain,
    /// The chain no longer validates against the public root set (e.g. a
    /// root was withdrawn), or was never publicly trusted.
    Distrusted,
}

/// What the UI may show about the material. Public certificate facts
/// only — the private key never appears here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpsCertificateSummary {
    /// Subject common name (full DN when no CN is present).
    pub subject: String,
    pub issuer: String,
    /// DNS entries of the leaf's Subject Alternative Names.
    pub sans: Vec<String>,
    /// RFC 3339 UTC.
    pub not_before: String,
    pub not_after: String,
    /// Whole days from `now` until `not_after` (negative once expired).
    /// i32 — days, and tauri-specta forbids i64 on the wire.
    pub days_remaining: i32,
    /// `AA:BB:…` uppercase colon-hex SHA-256 of the leaf DER — the
    /// operator-visible identity of the stored material.
    pub fingerprint: String,
    pub status: HttpsCertificateStatus,
}

/// One command answer: the stored/imported summary on success, the
/// readable problems when validation refused the material.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpsValidationOutcome {
    pub summary: Option<HttpsCertificateSummary>,
    pub problems: Vec<HttpsProblem>,
}

// ============================================================================
// Config-field validation
// ============================================================================

/// Validates and normalizes the operator's HTTPS domain. The parent
/// spec's boundary: a real DNS name a public CA can issue for — IP
/// literals, `.local`, scheme/host:port spellings and non-ASCII are all
/// rejected with a readable error. Uppercase input is accepted and
/// normalized to lowercase (DNS names are case-insensitive); a single
/// trailing root-dot is stripped.
pub fn validate_https_domain(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("The domain is empty.".to_string());
    }
    let lowered = trimmed.to_ascii_lowercase();
    let normalized = lowered.strip_suffix('.').unwrap_or(&lowered);

    if normalized.len() > 253 {
        return Err("The domain must be at most 253 characters.".to_string());
    }
    if !normalized.is_ascii() {
        return Err(format!(
            "The domain must be ASCII (punycode for international names): '{normalized}' is not."
        ));
    }
    // Whole-URL or host:port spellings the operator may paste by reflex.
    for marker in ['/', '\\', '?', '#', '@', ':', ' ', '%', '[', ']'] {
        if normalized.contains(marker) {
            return Err(format!(
                "Enter the bare domain only — no scheme, path, port or credentials (found '{marker}' in '{normalized}')."
            ));
        }
    }
    let labels: Vec<&str> = normalized.split('.').collect();
    if normalized.starts_with('.') || normalized.ends_with('.') || labels.len() < 2 {
        return Err(format!(
            "'{normalized}' is not a real DNS domain — a public-CA certificate needs a registrable name like show.example.org."
        ));
    }
    for label in &labels {
        if label.is_empty() || label.len() > 63 {
            return Err(format!(
                "Domain label '{label}' must be 1-63 characters in '{normalized}'."
            ));
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Err(format!(
                "Domain label '{label}' must not start or end with a hyphen."
            ));
        }
        if !label
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(format!(
                "Domain label '{label}' may only contain letters, digits and hyphens."
            ));
        }
    }
    // A dotted-quad input: call it out as an IP explicitly (the phone
    // story is "domain resolves via DNS", which an IP literal breaks) —
    // before the generic numeric-TLD rule gets a vaguer wording.
    if labels.len() == 4
        && labels
            .iter()
            .all(|l| !l.is_empty() && l.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err(format!(
            "'{normalized}' looks like an IP address — the HTTPS entry needs a real DNS domain (phones resolve the domain to this Mac via DNS)."
        ));
    }
    let tld = labels[labels.len() - 1];
    if tld == "local" {
        return Err(
            "'.local' names are multicast Bonjour names — a public CA cannot issue for them; use a real DNS domain."
                .to_string(),
        );
    }
    if tld.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!(
            "The top-level label '{tld}' is numeric — that is an IP-address shape, not a domain."
        ));
    }
    Ok(normalized.to_string())
}

/// The entry's listen port must be non-privileged — the Host never
/// installs a privileged 443 helper (parent spec). `u16` already rules
/// out >65535 at the serde boundary.
pub fn validate_https_port(port: u16) -> Result<(), String> {
    if (1024..=65535).contains(&port) {
        Ok(())
    } else {
        Err(format!(
            "Invalid HTTPS port {port}: choose a non-privileged port between 1024 and 65535 (e.g. 8443)."
        ))
    }
}

// ============================================================================
// PEM split / normalize
// ============================================================================

/// DER chain (leaf first) + the private key in its original encoding
/// (PKCS#8 / PKCS#1 / SEC1 — `PrivateKeyDer` keeps the kind).
struct SplitMaterial {
    chain_der: Vec<Vec<u8>>,
    key: PrivateKeyDer<'static>,
}

fn split_material(pem_text: &str) -> Result<SplitMaterial, HttpsProblem> {
    let mut cursor = std::io::Cursor::new(pem_text.as_bytes());
    let chain: Vec<CertificateDer> = certs(&mut cursor).collect::<Result<_, _>>().map_err(|e| {
        HttpsProblem::new(
            HttpsProblemCode::Parse,
            format!("The certificate file is not readable PEM: {e}"),
        )
    })?;
    let chain_der: Vec<Vec<u8>> = chain.iter().map(|cert| cert.to_vec()).collect();
    if chain_der.is_empty() {
        return Err(HttpsProblem::new(
            HttpsProblemCode::Parse,
            "No CERTIFICATE blocks found — pick the full certificate chain file (e.g. fullchain.pem), leaf first.",
        ));
    }
    let mut cursor = std::io::Cursor::new(pem_text.as_bytes());
    let key = private_key(&mut cursor)
        .map_err(|e| {
            HttpsProblem::new(
                HttpsProblemCode::Parse,
                format!("The private key file is not readable PEM: {e}"),
            )
        })?
        .ok_or_else(|| {
            HttpsProblem::new(
                HttpsProblemCode::Parse,
                "No private key block found — pick the key file that matches the certificate (e.g. privkey.pem).",
            )
        })?;
    Ok(SplitMaterial { chain_der, key })
}

/// Canonical stored form: every cert block, then the key block, base64
/// re-encoded from the parsed DER (input comments and ordering vanish).
fn encode_material_pem(chain_der: &[Vec<u8>], key: &PrivateKeyDer) -> String {
    let mut out = String::new();
    for der in chain_der {
        push_pem_block(&mut out, "CERTIFICATE", der);
    }
    let (label, der): (&str, &[u8]) = match key {
        PrivateKeyDer::Pkcs8(k) => ("PRIVATE KEY", k.secret_pkcs8_der()),
        PrivateKeyDer::Pkcs1(k) => ("RSA PRIVATE KEY", k.secret_pkcs1_der()),
        PrivateKeyDer::Sec1(k) => ("EC PRIVATE KEY", k.secret_sec1_der()),
        _ => ("PRIVATE KEY", key.secret_der()),
    };
    push_pem_block(&mut out, label, der);
    out
}

fn push_pem_block(out: &mut String, label: &str, der: &[u8]) {
    use base64::Engine as _;
    out.push_str("-----BEGIN ");
    out.push_str(label);
    out.push_str("-----\n");
    let encoded = base64::engine::general_purpose::STANDARD.encode(der);
    for chunk in encoded.as_bytes().chunks(64) {
        out.push_str(std::str::from_utf8(chunk).expect("base64 is ascii"));
        out.push('\n');
    }
    out.push_str("-----END ");
    out.push_str(label);
    out.push_str("-----\n");
}

// ============================================================================
// Leaf facts
// ============================================================================

struct LeafFacts {
    subject: String,
    issuer: String,
    sans: Vec<String>,
    not_before_unix: i64,
    not_after_unix: i64,
    not_before_rfc3339: String,
    not_after_rfc3339: String,
    /// The SubjectPublicKeyInfo bitstring — ring's derived public keys
    /// use exactly this representation.
    public_key_bits: Vec<u8>,
    self_signed: bool,
    /// The leaf's issuer certificate is present in the provided chain —
    /// used to split "missing intermediate" from "private CA".
    issuer_in_chain: bool,
}

fn parse_leaf(chain_der: &[Vec<u8>]) -> Result<LeafFacts, HttpsProblem> {
    let leaf_der = &chain_der[0];
    let (_, leaf) = parse_x509_certificate(leaf_der).map_err(|e| {
        HttpsProblem::new(
            HttpsProblemCode::Parse,
            format!("The leaf certificate does not parse as X.509: {e}"),
        )
    })?;

    let mut sans = Vec::new();
    for ext in leaf.extensions() {
        if let ParsedExtension::SubjectAlternativeName(san) = ext.parsed_extension() {
            for name in &san.general_names {
                if let GeneralName::DNSName(dns) = name {
                    sans.push(dns.to_lowercase());
                }
            }
        }
    }

    let not_before = leaf.validity().not_before.to_datetime();
    let not_after = leaf.validity().not_after.to_datetime();
    let subject = dn_display(leaf.subject());
    let issuer = dn_display(leaf.issuer());

    let mut issuer_in_chain = false;
    for der in chain_der.iter().skip(1) {
        if let Ok((_, cert)) = parse_x509_certificate(der) {
            if dn_display(cert.subject()) == issuer {
                issuer_in_chain = true;
            }
        }
    }

    Ok(LeafFacts {
        subject,
        issuer,
        sans,
        not_before_unix: not_before.unix_timestamp(),
        not_after_unix: not_after.unix_timestamp(),
        not_before_rfc3339: rfc3339(not_before),
        not_after_rfc3339: rfc3339(not_after),
        public_key_bits: leaf.public_key().subject_public_key.data.to_vec(),
        self_signed: dn_display(leaf.subject()) == dn_display(leaf.issuer()),
        issuer_in_chain,
    })
}

fn rfc3339(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).expect("ASN.1 times format as RFC 3339")
}

/// CN when present, full DN otherwise — the one-line form operators read.
fn dn_display(dn: &X509Name) -> String {
    dn.iter_common_name()
        .next()
        .map(|cn| cn.as_str().unwrap_or_default().to_string())
        .unwrap_or_else(|| format!("{dn}"))
}

fn days_between(now_unix: i64, then_unix: i64) -> i64 {
    (then_unix - now_unix).div_euclid(86_400)
}

fn unix_now(now: SystemTime) -> i64 {
    now.duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn sha256_fingerprint(der: &[u8]) -> String {
    let digest = Sha256::digest(der);
    digest
        .iter()
        .map(|b| format!("{b:02X}"))
        .collect::<Vec<_>>()
        .join(":")
}

// ============================================================================
// Chain, name and key verification
// ============================================================================

/// Webpki chain validation against the given anchors. Expiry / not-yet-
/// valid are caught earlier (with the real dates attached), so the
/// mapping here focuses on trust and chain shape.
fn verify_chain(
    chain_der: &[Vec<u8>],
    facts: &LeafFacts,
    anchors: &[TrustAnchor<'_>],
    now: SystemTime,
) -> Result<(), HttpsProblem> {
    use webpki::ring as webpki_ring;

    let supported: &[&dyn webpki::types::SignatureVerificationAlgorithm] = &[
        webpki_ring::ECDSA_P256_SHA256,
        webpki_ring::ECDSA_P256_SHA384,
        webpki_ring::ECDSA_P384_SHA256,
        webpki_ring::ECDSA_P384_SHA384,
        webpki_ring::ED25519,
        webpki_ring::RSA_PKCS1_2048_8192_SHA256,
        webpki_ring::RSA_PKCS1_2048_8192_SHA384,
        webpki_ring::RSA_PKCS1_2048_8192_SHA512,
        webpki_ring::RSA_PKCS1_3072_8192_SHA384,
    ];

    let leaf = CertificateDer::from(chain_der[0].clone());
    let intermediates: Vec<CertificateDer> = chain_der[1..]
        .iter()
        .map(|der| CertificateDer::from(der.clone()))
        .collect();
    let end_entity = webpki::EndEntityCert::try_from(&leaf).map_err(|e| {
        HttpsProblem::new(
            HttpsProblemCode::Parse,
            format!("The leaf certificate is malformed: {e}"),
        )
    })?;

    end_entity
        .verify_for_usage(
            supported,
            anchors,
            &intermediates,
            UnixTime::since_unix_epoch(std::time::Duration::from_secs(unix_now(now).max(0) as u64)),
            webpki::KeyUsage::server_auth(),
            None,
            None,
        )
        .map(|_| ())
        .map_err(|err| map_chain_error(err, facts))
}

/// The leaf facts split webpki's ambiguous `UnknownIssuer` into the two
/// operator situations (missing intermediate vs. not a public CA).
fn map_chain_error(err: webpki::Error, facts: &LeafFacts) -> HttpsProblem {
    match err {
        webpki::Error::CertExpired => HttpsProblem::new(
            HttpsProblemCode::Expired,
            "The certificate's validity period has ended — renew it with your CA and re-import.",
        ),
        webpki::Error::CertNotValidYet => HttpsProblem::new(
            HttpsProblemCode::NotYetValid,
            "The certificate's validity period has not started yet.",
        ),
        webpki::Error::UnknownIssuer => {
            if facts.self_signed {
                HttpsProblem::new(
                    HttpsProblemCode::NotPubliclyTrusted,
                    "The certificate is self-signed — phones trust only public CAs; import a certificate issued by a public CA.",
                )
            } else if facts.issuer_in_chain {
                HttpsProblem::new(
                    HttpsProblemCode::NotPubliclyTrusted,
                    "The chain is complete but does not root in a publicly trusted CA — import a public-CA certificate, not one from a private CA.",
                )
            } else {
                HttpsProblem::new(
                    HttpsProblemCode::IncompleteChain,
                    "The certificate chain is incomplete — import the full chain (leaf + intermediates, e.g. fullchain.pem).",
                )
            }
        }
        other => HttpsProblem::new(
            HttpsProblemCode::NotPubliclyTrusted,
            format!("The certificate chain does not validate against the public root set: {other}"),
        ),
    }
}

fn verify_dns_name(chain_der: &[Vec<u8>], domain: &str) -> Result<(), HttpsProblem> {
    let leaf = CertificateDer::from(chain_der[0].clone());
    let end_entity = webpki::EndEntityCert::try_from(&leaf).map_err(|e| {
        HttpsProblem::new(
            HttpsProblemCode::Parse,
            format!("The leaf certificate is malformed: {e}"),
        )
    })?;
    let name = webpki::types::ServerName::try_from(domain.to_string()).map_err(|_| {
        HttpsProblem::new(
            HttpsProblemCode::DomainMismatch,
            format!("'{domain}' is not a valid DNS name."),
        )
    })?;
    end_entity
        .verify_is_valid_for_subject_name(&name)
        .map_err(|_| {
            HttpsProblem::new(
                HttpsProblemCode::Parse,
                "DNS name verification failed unexpectedly.".to_string(),
            )
        })
}

// ============================================================================
// Key match
// ============================================================================

/// Derives the public key bytes from the private key via ring and
/// compares them with the leaf's SPKI bitstring. PKCS#8 / PKCS#1 parse
/// directly; SEC1 EC keys are wrapped into PKCS#8 first (`wrap_sec1`).
fn verify_key_match(key: &PrivateKeyDer, leaf_public_bits: &[u8]) -> Result<(), HttpsProblem> {
    let public = key_public_bytes(key)
        .map_err(|detail| HttpsProblem::new(HttpsProblemCode::Parse, detail))?;
    if public == leaf_public_bits {
        Ok(())
    } else {
        Err(HttpsProblem::new(
            HttpsProblemCode::KeyMismatch,
            "The private key does not match the certificate — pick the key issued with this certificate.",
        ))
    }
}

fn key_public_bytes(key: &PrivateKeyDer) -> Result<Vec<u8>, String> {
    use ring::signature::KeyPair as _;
    let rng = ring::rand::SystemRandom::new();
    match key {
        PrivateKeyDer::Pkcs8(k) => public_from_pkcs8(k.secret_pkcs8_der(), &rng),
        PrivateKeyDer::Pkcs1(k) => ring::signature::RsaKeyPair::from_der(k.secret_pkcs1_der())
            .map(|kp| kp.public_key().as_ref().to_vec())
            .map_err(|e| format!("The RSA private key does not parse: {e}")),
        PrivateKeyDer::Sec1(k) => {
            let sec1_der = k.secret_sec1_der();
            let wrapped = match wrap_sec1_as_pkcs8(sec1_der) {
                Ok(wrapped) => wrapped,
                // Parameters omitted (PKCS#8-derived SEC1): the scalar
                // length pins the curve in practice — try the two curves
                // phones' certificates actually use.
                Err(_) if sec1_der.len() < 200 => {
                    wrap_pkcs8_with_curve_oid(sec1_der, CURVE_P256_OID)
                }
                Err(_) => wrap_pkcs8_with_curve_oid(sec1_der, CURVE_P384_OID),
            };
            public_from_pkcs8(&wrapped, &rng)
        }
        other => Err(format!(
            "Unsupported private-key kind: {:?}",
            std::mem::discriminant(other)
        )),
    }
}

fn public_from_pkcs8(der: &[u8], rng: &ring::rand::SystemRandom) -> Result<Vec<u8>, String> {
    use ring::signature::KeyPair as _;
    if let Ok(kp) = ring::signature::Ed25519KeyPair::from_pkcs8(der) {
        return Ok(kp.public_key().as_ref().to_vec());
    }
    for alg in [
        &ring::signature::ECDSA_P256_SHA256_FIXED_SIGNING,
        &ring::signature::ECDSA_P384_SHA384_FIXED_SIGNING,
    ] {
        if let Ok(kp) = ring::signature::EcdsaKeyPair::from_pkcs8(alg, der, rng) {
            return Ok(kp.public_key().as_ref().to_vec());
        }
    }
    ring::signature::RsaKeyPair::from_pkcs8(der)
        .map(|kp| kp.public_key().as_ref().to_vec())
        .map_err(|_| {
            "The private key format is not supported (expected Ed25519, EC P-256/P-384 or RSA)."
                .to_string()
        })
}

/// Wraps a SEC1 `EC PRIVATE KEY` DER into PKCS#8 so ring accepts it —
/// the mechanical `PrivateKeyInfo { 0, (ecPublicKey, curve), sec1 }`
/// encoding, hand-rolled to keep the dependency surface at `sec1`.
/// Real SEC1 files carry the curve in their optional parameters; the
/// PKCS#8-derived bodies some tools emit omit it, so the named-curve
/// OIDs for P-256 / P-384 are tried as a fallback in the caller.
fn wrap_sec1_as_pkcs8(sec1_der: &[u8]) -> Result<Vec<u8>, String> {
    use sec1::der::Decode;
    let ec = sec1::EcPrivateKey::from_der(sec1_der)
        .map_err(|e| format!("The EC private key does not parse: {e}"))?;
    let curve_oid = match ec.parameters {
        Some(sec1::EcParameters::NamedCurve(oid)) => oid.as_bytes().to_vec(),
        _ => return Err(String::from("The EC private key does not name its curve.")),
    };
    Ok(wrap_pkcs8_with_curve_oid(sec1_der, &curve_oid))
}

const EC_PUBLIC_KEY_OID: &[u8] = &[0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01]; // 1.2.840.10045.2.1
const CURVE_P256_OID: &[u8] = &[0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07]; // 1.2.840.10045.3.1.7
const CURVE_P384_OID: &[u8] = &[0x2B, 0x81, 0x04, 0x00, 0x22]; // 1.3.132.0.34

fn wrap_pkcs8_with_curve_oid(sec1_der: &[u8], curve_oid: &[u8]) -> Vec<u8> {
    let mut algorithm = Vec::new();
    put_der_tlv(&mut algorithm, 0x06, EC_PUBLIC_KEY_OID);
    put_der_tlv(&mut algorithm, 0x06, curve_oid);

    let mut body = Vec::new();
    put_der_tlv(&mut body, 0x02, &[0x00]); // version 0
    put_der_tlv(&mut body, 0x30, &algorithm);
    put_der_tlv(&mut body, 0x04, sec1_der);

    let mut out = Vec::new();
    put_der_tlv(&mut out, 0x30, &body);
    out
}

fn put_der_tlv(out: &mut Vec<u8>, tag: u8, content: &[u8]) {
    out.push(tag);
    if content.len() < 0x80 {
        out.push(content.len() as u8);
    } else {
        let bytes = content.len().to_be_bytes();
        let first = bytes
            .iter()
            .position(|b| *b != 0)
            .unwrap_or(bytes.len() - 1);
        let significant = &bytes[first..];
        out.push(0x80 | significant.len() as u8);
        out.extend_from_slice(significant);
    }
    out.extend_from_slice(content);
}

// ============================================================================
// The one validation pipeline
// ============================================================================

fn summary_of(
    facts: &LeafFacts,
    fingerprint: String,
    status: HttpsCertificateStatus,
    now_unix: i64,
) -> HttpsCertificateSummary {
    HttpsCertificateSummary {
        subject: facts.subject.clone(),
        issuer: facts.issuer.clone(),
        sans: facts.sans.clone(),
        not_before: facts.not_before_rfc3339.clone(),
        not_after: facts.not_after_rfc3339.clone(),
        days_remaining: days_between(now_unix, facts.not_after_unix) as i32,
        fingerprint,
        status,
    }
}

/// Validates material end to end. Returns the canonical stored PEM plus
/// the summary. `domain`: `Some` checks SAN coverage (import always
/// passes it; the stored-material reload passes the current preference);
/// `None` skips the name check.
fn validate_material(
    domain: Option<&str>,
    pem_text: &str,
    anchors: &[TrustAnchor<'_>],
    now: SystemTime,
) -> Result<(String, HttpsCertificateSummary), HttpsProblem> {
    let split = split_material(pem_text)?;
    let facts = parse_leaf(&split.chain_der)?;
    let now_unix = unix_now(now);

    // Dates first — the most actionable failure, carrying the real
    // validity window the operator needs to see.
    if now_unix >= facts.not_after_unix {
        return Err(HttpsProblem::new(
            HttpsProblemCode::Expired,
            format!(
                "The certificate expired on {} — renew it with your CA and re-import.",
                facts.not_after_rfc3339
            ),
        ));
    }
    if now_unix < facts.not_before_unix {
        return Err(HttpsProblem::new(
            HttpsProblemCode::NotYetValid,
            format!(
                "The certificate is not valid until {} — check the issuing machine's clock or wait.",
                facts.not_before_rfc3339
            ),
        ));
    }

    verify_key_match(&split.key, &facts.public_key_bits)?;
    verify_chain(&split.chain_der, &facts, anchors, now)?;

    if let Some(domain) = domain {
        let domain = validate_https_domain(domain)
            .map_err(|e| HttpsProblem::new(HttpsProblemCode::DomainMismatch, e))?;
        verify_dns_name(&split.chain_der, &domain).map_err(|_| {
            HttpsProblem::new(
                HttpsProblemCode::DomainMismatch,
                format!(
                    "The certificate does not cover '{domain}' — it covers: {}.",
                    if facts.sans.is_empty() {
                        "(no DNS names)".to_string()
                    } else {
                        facts.sans.join(", ")
                    }
                ),
            )
        })?;
    }

    let status = if days_between(now_unix, facts.not_after_unix) <= EXPIRY_REMINDER_DAYS {
        HttpsCertificateStatus::ExpiringSoon
    } else {
        HttpsCertificateStatus::Valid
    };
    let summary = summary_of(
        &facts,
        sha256_fingerprint(&split.chain_der[0]),
        status,
        now_unix,
    );
    Ok((encode_material_pem(&split.chain_der, &split.key), summary))
}

// ============================================================================
// Storage
// ============================================================================

fn material_path(app_data: &Path) -> PathBuf {
    app_data.join(MATERIAL_DIR_NAME).join(MATERIAL_FILE_NAME)
}

/// Atomic protected write: temp file (0600) + rename inside a 0700 dir.
/// One file for chain + key, so a replacement either fully lands or
/// fully does not.
fn store_material(app_data: &Path, pem: &str) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

    let dir = app_data.join(MATERIAL_DIR_NAME);
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir)
        .or_else(|e| {
            // An existing dir keeps its (possibly looser) mode — tighten it.
            let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
            if dir.is_dir() {
                Ok(())
            } else {
                Err(e)
            }
        })
        .map_err(|e| format!("Failed to create the protected HTTPS material directory: {e}"))?;

    let file = material_path(app_data);
    let tmp = dir.join(format!("{MATERIAL_FILE_NAME}.tmp"));
    let mut handle = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|e| format!("Failed to write the HTTPS material: {e}"))?;
    handle
        .write_all(pem.as_bytes())
        .map_err(|e| format!("Failed to write the HTTPS material: {e}"))?;
    drop(handle);
    std::fs::rename(&tmp, &file).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Failed to finalize the HTTPS material: {e}")
    })
}

fn load_material_pem(app_data: &Path) -> Option<String> {
    std::fs::read_to_string(material_path(app_data)).ok()
}

/// Removes the stored material. Returns whether anything was removed.
fn clear_material(app_data: &Path) -> Result<bool, String> {
    let file = material_path(app_data);
    if !file.exists() {
        return Ok(false);
    }
    std::fs::remove_file(&file).map_err(|e| format!("Failed to remove the HTTPS material: {e}"))?;
    Ok(true)
}

// ============================================================================
// Entry points used by the command layer
// ============================================================================

/// Reads the two picked files and runs the full validation. On success
/// the normalized material is committed atomically; on ANY problem the
/// stored material is untouched (replacement atomicity, #139 AC2).
pub fn import_material(
    app_data: &Path,
    domain: &str,
    certificate_pem_path: &Path,
    private_key_pem_path: &Path,
    anchors: &[TrustAnchor<'_>],
    now: SystemTime,
) -> Result<HttpsValidationOutcome, String> {
    let cert_text = std::fs::read_to_string(certificate_pem_path).map_err(|e| {
        format!(
            "Failed to read the certificate file {}: {e}",
            certificate_pem_path.display()
        )
    })?;
    let key_text = std::fs::read_to_string(private_key_pem_path).map_err(|e| {
        format!(
            "Failed to read the private key file {}: {e}",
            private_key_pem_path.display()
        )
    })?;
    let combined = format!("{cert_text}\n{key_text}\n");

    match validate_material(Some(domain), &combined, anchors, now) {
        Ok((pem, summary)) => {
            // Never log the material — the fingerprint is public data.
            log::info!(
                "HTTPS material imported: fingerprint {} (valid until {})",
                summary.fingerprint,
                summary.not_after
            );
            store_material(app_data, &pem)?;
            Ok(HttpsValidationOutcome {
                summary: Some(summary),
                problems: Vec::new(),
            })
        }
        Err(problem) => {
            log::warn!(
                "HTTPS material import rejected: {:?} ({})",
                problem.code,
                problem.detail
            );
            Ok(HttpsValidationOutcome {
                summary: None,
                problems: vec![problem],
            })
        }
    }
}

/// Restores the stored material after a restart and re-derives its
/// standing against the current domain and clock. `Ok(None)` = nothing
/// stored. Revalidation problems (expired since import, domain changed)
/// ride alongside the summary instead of hiding it.
pub fn summarize_stored(
    app_data: &Path,
    domain: Option<&str>,
    anchors: &[TrustAnchor<'_>],
    now: SystemTime,
) -> Result<Option<HttpsValidationOutcome>, String> {
    let Some(pem) = load_material_pem(app_data) else {
        return Ok(None);
    };
    let normalized_domain = domain
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(|d| validate_https_domain(d).unwrap_or_else(|_| d.to_string()));

    match validate_material(normalized_domain.as_deref(), &pem, anchors, now) {
        Ok((_, summary)) => Ok(Some(HttpsValidationOutcome {
            summary: Some(summary),
            problems: Vec::new(),
        })),
        Err(problem) => {
            // Keep showing the certificate's facts with the failure
            // folded into status + problem list.
            let split = split_material(&pem).map_err(|p| p.detail)?;
            let facts = parse_leaf(&split.chain_der).map_err(|p| p.detail)?;
            let status = match problem.code {
                HttpsProblemCode::Expired => HttpsCertificateStatus::Expired,
                HttpsProblemCode::NotYetValid => HttpsCertificateStatus::NotYetValid,
                HttpsProblemCode::DomainMismatch => HttpsCertificateStatus::WrongDomain,
                _ => HttpsCertificateStatus::Distrusted,
            };
            let summary = summary_of(
                &facts,
                sha256_fingerprint(&split.chain_der[0]),
                status,
                unix_now(now),
            );
            Ok(Some(HttpsValidationOutcome {
                summary: Some(summary),
                problems: vec![problem],
            }))
        }
    }
}

/// Removes the stored material (the settings「清除」button).
pub fn clear_stored_material(app_data: &Path) -> Result<bool, String> {
    let removed = clear_material(app_data)?;
    if removed {
        log::info!("HTTPS certificate material removed by the operator");
    }
    Ok(removed)
}

/// #140: the entry gateway's launch material — the stored chain + key,
/// revalidated against `domain` at `now` under the SAME rules as the
/// import (public trust, SAN coverage, validity window, key match).
/// Success hands back the parsed pieces the TLS listener serves with;
/// any problem is a launch failure the start surfaces as its error —
/// an adapted project with the entry enabled never silently falls back
/// to HTTP. The material itself still never leaves this crate.
pub fn launch_material(
    app_data: &Path,
    domain: &str,
    anchors: &[TrustAnchor<'_>],
    now: SystemTime,
) -> Result<(Vec<CertificateDer<'static>>, PrivateKeyDer<'static>), HttpsProblem> {
    let pem = load_material_pem(app_data).ok_or_else(|| {
        HttpsProblem::new(
            HttpsProblemCode::Storage,
            "No certificate material is stored — import the full chain + key in 设置 → 可信 HTTPS before starting with the HTTPS entry enabled.",
        )
    })?;
    validate_material(Some(domain), &pem, anchors, now)?;
    let split = split_material(&pem)?;
    let chain = split
        .chain_der
        .into_iter()
        .map(CertificateDer::from)
        .collect();
    Ok((chain, split.key))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ::time::Duration as IsoDuration;

    // ------------------------------------------------------------------
    // rcgen fixtures: a test CA -> intermediate -> leaf chain, the shape
    // a public CA delivers (anchors = the test CA, NOT webpki-roots).
    // ------------------------------------------------------------------

    struct TestChain {
        leaf_pem: String,
        leaf_key_pem: String,
        chain_pem: String,
        anchors: Vec<TrustAnchor<'static>>,
    }

    fn ca_params(cn: &str) -> rcgen::CertificateParams {
        let mut params = rcgen::CertificateParams::new(Vec::<String>::new()).expect("params");
        params.is_ca = rcgen::IsCa::Ca(rcgen::BasicConstraints::Unconstrained);
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, cn);
        params
    }

    fn leaf_params(
        sans: &[&str],
        not_before: OffsetDateTime,
        not_after: OffsetDateTime,
    ) -> rcgen::CertificateParams {
        let mut params = rcgen::CertificateParams::new(
            sans.iter().map(|s| s.to_string()).collect::<Vec<String>>(),
        )
        .expect("params");
        params
            .distinguished_name
            .push(rcgen::DnType::CommonName, sans[0]);
        params.not_before = not_before;
        params.not_after = not_after;
        params
    }

    fn gen_chain(sans: &[&str]) -> TestChain {
        gen_chain_with_validity(
            sans,
            OffsetDateTime::now_utc() - IsoDuration::days(10),
            OffsetDateTime::now_utc() + IsoDuration::days(80),
        )
    }

    fn gen_chain_with_validity(
        sans: &[&str],
        not_before: OffsetDateTime,
        not_after: OffsetDateTime,
    ) -> TestChain {
        let ca_key = rcgen::KeyPair::generate().expect("ca key");
        let ca = ca_params("PNDS Test Root CA")
            .self_signed(&ca_key)
            .expect("ca cert");

        let inter_key = rcgen::KeyPair::generate().expect("inter key");
        let inter = ca_params("PNDS Test Intermediate CA")
            .signed_by(&inter_key, &ca, &ca_key)
            .expect("inter cert");

        let leaf_key = rcgen::KeyPair::generate().expect("leaf key");
        let leaf = leaf_params(sans, not_before, not_after)
            .signed_by(&leaf_key, &inter, &inter_key)
            .expect("leaf cert");

        let chain_pem = format!("{}{}{}", leaf.pem(), inter.pem(), ca.pem());
        // Leak the CA DER so the anchor is 'static — test fixtures only.
        let ca_der: &'static CertificateDer = Box::leak(Box::new(ca.der().clone()));
        let anchors = vec![webpki::anchor_from_trusted_cert(ca_der).expect("anchor")];
        TestChain {
            leaf_pem: leaf.pem(),
            leaf_key_pem: leaf_key.serialize_pem(),
            chain_pem,
            anchors,
        }
    }

    fn now() -> SystemTime {
        SystemTime::now()
    }

    fn write_import_files(dir: &Path, chain: &TestChain, prefix: &str) -> (PathBuf, PathBuf) {
        let cert = dir.join(format!("{prefix}-fullchain.pem"));
        let key = dir.join(format!("{prefix}-privkey.pem"));
        std::fs::write(&cert, &chain.chain_pem).unwrap();
        std::fs::write(&key, &chain.leaf_key_pem).unwrap();
        (cert, key)
    }

    // ------------------------------------------------------------------
    // Domain / port validation
    // ------------------------------------------------------------------

    #[test]
    fn validates_and_normalizes_https_domain() {
        assert_eq!(
            validate_https_domain("show.example.org").unwrap(),
            "show.example.org"
        );
        // case + trailing dot normalization, surrounding whitespace
        assert_eq!(
            validate_https_domain("  Show.Example.ORG. ").unwrap(),
            "show.example.org"
        );
        // wildcard is a certificate-side property — the entry URL needs a
        // concrete host
        assert!(validate_https_domain("*.example.org").is_err());
        for bad in [
            "",
            "   ",
            "https://show.example.org",
            "show.example.org:8443",
            "show.example.org/path",
            "user@show.example.org",
            "192.168.1.10",
            "fe80::1",
            "macbook.local",
            "example",
            "-bad.example.org",
            "bad-.example.org",
            "under_score.example.org",
            "show.123",
            "show..example.org",
        ] {
            assert!(
                validate_https_domain(bad).is_err(),
                "{bad:?} must be rejected"
            );
        }
        // readable errors name the situation
        let err = validate_https_domain("192.168.1.10").unwrap_err();
        assert!(err.contains("IP address"), "got: {err}");
        let err = validate_https_domain("macbook.local").unwrap_err();
        assert!(err.contains(".local"), "got: {err}");
    }

    #[test]
    fn validates_https_port() {
        assert!(validate_https_port(8443).is_ok());
        assert!(validate_https_port(1024).is_ok());
        assert!(validate_https_port(65535).is_ok());
        for bad in [80u16, 443, 1023, 0] {
            let err = validate_https_port(bad).unwrap_err();
            assert!(err.contains("non-privileged"), "got: {err}");
        }
    }

    // ------------------------------------------------------------------
    // Validation pipeline
    // ------------------------------------------------------------------

    #[test]
    fn accepts_a_complete_publicly_anchored_chain() {
        let chain = gen_chain(&["show.example.org"]);
        let pem = format!("{}\n{}", chain.chain_pem, chain.leaf_key_pem);
        let (stored, summary) =
            validate_material(Some("show.example.org"), &pem, &chain.anchors, now())
                .expect("valid material");
        assert!(stored.contains("BEGIN CERTIFICATE"));
        assert_eq!(summary.subject, "show.example.org");
        assert_eq!(summary.sans, vec!["show.example.org".to_string()]);
        assert_eq!(summary.status, HttpsCertificateStatus::Valid);
        assert!(summary.days_remaining >= 79 && summary.days_remaining <= 80);
        assert_eq!(summary.fingerprint.split(':').count(), 32);
        assert!(summary.not_after.ends_with('Z'));
    }

    #[test]
    fn accepts_wildcard_san_for_subdomain() {
        let chain = gen_chain(&["*.example.org"]);
        let pem = format!("{}\n{}", chain.chain_pem, chain.leaf_key_pem);
        let (_, summary) =
            validate_material(Some("stage.example.org"), &pem, &chain.anchors, now())
                .expect("wildcard covers one-label subdomain");
        assert_eq!(summary.status, HttpsCertificateStatus::Valid);
    }

    #[test]
    fn rejects_domain_mismatch_listing_actual_sans() {
        let chain = gen_chain(&["show.example.org"]);
        let pem = format!("{}\n{}", chain.chain_pem, chain.leaf_key_pem);
        let err = validate_material(Some("other.example.net"), &pem, &chain.anchors, now())
            .expect_err("must be rejected");
        assert_eq!(err.code, HttpsProblemCode::DomainMismatch);
        assert!(err.detail.contains("show.example.org"), "got: {err:?}");
    }

    #[test]
    fn rejects_missing_intermediate() {
        let chain = gen_chain(&["show.example.org"]);
        // leaf + key but no intermediate: the issuer cert is absent.
        let pem = format!("{}\n{}", chain.leaf_pem, chain.leaf_key_pem);
        let err = validate_material(Some("show.example.org"), &pem, &chain.anchors, now())
            .expect_err("must be rejected");
        assert_eq!(err.code, HttpsProblemCode::IncompleteChain);
        assert!(err.detail.contains("full chain"), "got: {err:?}");
    }

    #[test]
    fn rejects_self_signed_leaf() {
        let chain = gen_chain(&["show.example.org"]);
        let self_key = rcgen::KeyPair::generate().expect("key");
        let self_leaf = leaf_params(
            &["show.example.org"],
            OffsetDateTime::now_utc() - IsoDuration::days(1),
            OffsetDateTime::now_utc() + IsoDuration::days(80),
        )
        .self_signed(&self_key)
        .expect("self-signed");
        let pem = format!("{}\n{}", self_leaf.pem(), self_key.serialize_pem());
        let err = validate_material(Some("show.example.org"), &pem, &chain.anchors, now())
            .expect_err("must be rejected");
        assert_eq!(err.code, HttpsProblemCode::NotPubliclyTrusted);
        assert!(err.detail.contains("self-signed"), "got: {err:?}");
    }

    #[test]
    fn rejects_private_ca_chain_not_in_anchors() {
        let chain = gen_chain(&["show.example.org"]);
        let other_root_key = rcgen::KeyPair::generate().expect("key");
        let other_root = ca_params("Some Other Root")
            .self_signed(&other_root_key)
            .expect("root");
        let unrelated_anchors =
            vec![webpki::anchor_from_trusted_cert(other_root.der()).expect("anchor")];
        let pem = format!("{}\n{}", chain.chain_pem, chain.leaf_key_pem);
        // Complete chain, issuer present, but roots differ -> private CA
        // wording rather than "missing intermediate".
        let err = validate_material(Some("show.example.org"), &pem, &unrelated_anchors, now())
            .expect_err("must be rejected");
        assert_eq!(err.code, HttpsProblemCode::NotPubliclyTrusted);
        assert!(err.detail.contains("publicly trusted"), "got: {err:?}");
    }

    #[test]
    fn rejects_key_mismatch() {
        let chain = gen_chain(&["show.example.org"]);
        let other_key = rcgen::KeyPair::generate().expect("unrelated key");
        let pem = format!("{}\n{}", chain.chain_pem, other_key.serialize_pem());
        let err = validate_material(Some("show.example.org"), &pem, &chain.anchors, now())
            .expect_err("must be rejected");
        assert_eq!(err.code, HttpsProblemCode::KeyMismatch);
    }

    #[test]
    fn rejects_expired_with_real_date() {
        let chain = gen_chain_with_validity(
            &["show.example.org"],
            OffsetDateTime::now_utc() - IsoDuration::days(90),
            OffsetDateTime::now_utc() - IsoDuration::days(1),
        );
        let pem = format!("{}\n{}", chain.chain_pem, chain.leaf_key_pem);
        let err = validate_material(Some("show.example.org"), &pem, &chain.anchors, now())
            .expect_err("must be rejected");
        assert_eq!(err.code, HttpsProblemCode::Expired);
        assert!(err.detail.contains("expired on"), "got: {err:?}");
    }

    #[test]
    fn rejects_not_yet_valid() {
        let chain = gen_chain_with_validity(
            &["show.example.org"],
            OffsetDateTime::now_utc() + IsoDuration::days(1),
            OffsetDateTime::now_utc() + IsoDuration::days(90),
        );
        let pem = format!("{}\n{}", chain.chain_pem, chain.leaf_key_pem);
        let err = validate_material(Some("show.example.org"), &pem, &chain.anchors, now())
            .expect_err("must be rejected");
        assert_eq!(err.code, HttpsProblemCode::NotYetValid);
    }

    #[test]
    fn imports_within_reminder_window_but_flags_expiring_soon() {
        let chain = gen_chain_with_validity(
            &["show.example.org"],
            OffsetDateTime::now_utc() - IsoDuration::days(80),
            OffsetDateTime::now_utc() + IsoDuration::days(10),
        );
        let pem = format!("{}\n{}", chain.chain_pem, chain.leaf_key_pem);
        let (_, summary) = validate_material(Some("show.example.org"), &pem, &chain.anchors, now())
            .expect("still valid — imported with a warning");
        assert_eq!(summary.status, HttpsCertificateStatus::ExpiringSoon);
        assert!(summary.days_remaining <= 10);
    }

    #[test]
    fn rejects_garbage_and_missing_parts() {
        let chain = gen_chain(&["show.example.org"]);
        let anchors = &chain.anchors;
        let bad_bodies = [
            "not pem at all".to_string(),
            chain.chain_pem.clone(),             // no key
            format!("{}\n", chain.leaf_key_pem), // no cert
            "-----BEGIN CERTIFICATE-----\nZm9v\n-----END CERTIFICATE-----\n".to_string(),
        ];
        for bad in &bad_bodies {
            assert!(
                validate_material(Some("show.example.org"), bad, anchors, now()).is_err(),
                "must be rejected"
            );
        }
    }

    #[test]
    fn tolerates_comment_noise_around_pem_blocks() {
        let chain = gen_chain(&["show.example.org"]);
        let noisy = format!(
            "# operator notes\n{}\n# key follows\n{}\n",
            chain.chain_pem, chain.leaf_key_pem
        );
        assert!(validate_material(Some("show.example.org"), &noisy, &chain.anchors, now()).is_ok());
    }

    #[test]
    fn skips_name_check_when_no_domain_configured() {
        let chain = gen_chain(&["show.example.org"]);
        let pem = format!("{}\n{}", chain.chain_pem, chain.leaf_key_pem);
        assert!(validate_material(None, &pem, &chain.anchors, now()).is_ok());
    }

    // ------------------------------------------------------------------
    // SEC1 wrap
    // ------------------------------------------------------------------

    #[test]
    fn wraps_sec1_ec_keys_into_pkcs8_for_ring() {
        // rcgen generates PKCS#8; the EC private key sits inside as the
        // SEC1 DER — unwrap it and prove the wrap makes ring accept it.
        let key = rcgen::KeyPair::generate().expect("key");
        let pkcs8_pem = key.serialize_pem();
        use base64::Engine as _;
        let der = base64::engine::general_purpose::STANDARD
            .decode(
                pkcs8_pem
                    .lines()
                    .filter(|l| !l.starts_with("-----"))
                    .collect::<String>(),
            )
            .expect("pkcs8 der");

        // PrivateKeyInfo ::= SEQUENCE { INTEGER, SEQUENCE, OCTET STRING }
        // — walking TLVs with both length forms (PKCS#8 bodies exceed 127
        // bytes, so the long form is the norm here).
        fn take_tlv(der: &[u8], tag: u8) -> (&[u8], &[u8]) {
            assert_eq!(der[0], tag, "tag mismatch");
            let (len, header) = der_len(der);
            (&der[header..header + len], &der[header + len..])
        }
        fn der_len(der: &[u8]) -> (usize, usize) {
            if der[1] & 0x80 == 0 {
                (der[1] as usize, 2)
            } else {
                let n = (der[1] & 0x7f) as usize;
                let mut len = 0usize;
                for byte in &der[2..2 + n] {
                    len = (len << 8) | *byte as usize;
                }
                (len, 2 + n)
            }
        }
        let (body, _) = take_tlv(&der, 0x30); // PrivateKeyInfo
        let (_, rest) = take_tlv(body, 0x02); // version
        let (_, rest) = take_tlv(rest, 0x30); // algorithm
        let (sec1, _) = take_tlv(rest, 0x04); // privateKey = SEC1

        let wrapped = wrap_sec1_as_pkcs8(sec1);
        assert!(wrapped.is_err(), "params-less SEC1 must ask for a curve");

        // The production entry: a Sec1 PrivateKeyDer resolves its public
        // key through the fallback (scalar length picks the curve).
        let sec1_key = rustls_pemfile::private_key(&mut std::io::Cursor::new({
            let mut pem = String::new();
            // re-encode the SEC1 DER as its own PEM block
            use base64::Engine as _;
            pem.push_str("-----BEGIN EC PRIVATE KEY-----\n");
            let b64 = base64::engine::general_purpose::STANDARD.encode(sec1);
            for chunk in b64.as_bytes().chunks(64) {
                pem.push_str(std::str::from_utf8(chunk).unwrap());
                pem.push('\n');
            }
            pem.push_str("-----END EC PRIVATE KEY-----\n");
            pem.as_bytes().to_vec()
        }))
        .expect("sec1 key parse")
        .expect("key present");
        let public = key_public_bytes(&sec1_key).expect("fallback resolves the public key");
        assert_eq!(public[0], 0x04);
    }

    // ------------------------------------------------------------------
    // Storage: save / restore / atomic replacement / permissions
    // ------------------------------------------------------------------

    #[test]
    fn stores_restores_and_clears_material() {
        let root = tempfile::tempdir().expect("root");
        let chain = gen_chain(&["show.example.org"]);
        let (cert, key) = write_import_files(root.path(), &chain, "a");

        let outcome = import_material(
            root.path(),
            "show.example.org",
            &cert,
            &key,
            &chain.anchors,
            now(),
        )
        .expect("import io");
        assert!(outcome.summary.is_some());
        assert!(outcome.problems.is_empty());

        // Protected storage shape: 0700 dir, 0600 file, no tmp leftover.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let dir_mode = std::fs::metadata(root.path().join(MATERIAL_DIR_NAME))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(dir_mode & 0o777, 0o700);
            let file_mode = std::fs::metadata(material_path(root.path()))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(file_mode & 0o777, 0o600);
        }
        assert!(!root
            .path()
            .join(MATERIAL_DIR_NAME)
            .join("material.pem.tmp")
            .exists());

        // Restore: the reload path sees the same material.
        let restored =
            summarize_stored(root.path(), Some("show.example.org"), &chain.anchors, now())
                .expect("summarize")
                .expect("stored");
        assert!(restored.problems.is_empty());
        assert_eq!(
            restored.summary.expect("summary").fingerprint,
            outcome.summary.expect("summary").fingerprint
        );

        assert!(clear_material(root.path()).unwrap());
        assert!(!material_path(root.path()).exists());
        assert!(!clear_material(root.path()).unwrap());
        assert!(summarize_stored(root.path(), None, &chain.anchors, now())
            .unwrap()
            .is_none());
    }

    #[test]
    fn failed_replacement_keeps_the_stored_material() {
        let root = tempfile::tempdir().expect("root");
        let good = gen_chain(&["show.example.org"]);
        let (cert, key) = write_import_files(root.path(), &good, "a");
        import_material(
            root.path(),
            "show.example.org",
            &cert,
            &key,
            &good.anchors,
            now(),
        )
        .expect("first import");
        let before = std::fs::read(material_path(root.path())).unwrap();

        // A mismatched key for the new certificate -> rejected, stored
        // bytes untouched.
        let replacement = gen_chain(&["next.example.org"]);
        let (replacement_cert, _) = write_import_files(root.path(), &replacement, "b");
        let wrong_key_path = root.path().join("wrong-key.pem");
        std::fs::write(
            &wrong_key_path,
            rcgen::KeyPair::generate().unwrap().serialize_pem(),
        )
        .unwrap();
        let outcome = import_material(
            root.path(),
            "next.example.org",
            &replacement_cert,
            &wrong_key_path,
            &replacement.anchors,
            now(),
        )
        .expect("import io");
        assert!(outcome.summary.is_none());
        assert_eq!(outcome.problems.len(), 1);
        assert_eq!(outcome.problems[0].code, HttpsProblemCode::KeyMismatch);
        let after = std::fs::read(material_path(root.path())).unwrap();
        assert_eq!(
            before, after,
            "failed replacement must not touch stored material"
        );
    }

    #[test]
    fn successful_replacement_swaps_the_material() {
        let root = tempfile::tempdir().expect("root");
        let first = gen_chain(&["show.example.org"]);
        let (cert, key) = write_import_files(root.path(), &first, "a");
        import_material(
            root.path(),
            "show.example.org",
            &cert,
            &key,
            &first.anchors,
            now(),
        )
        .expect("first import");
        let first_summary =
            summarize_stored(root.path(), Some("show.example.org"), &first.anchors, now())
                .unwrap()
                .unwrap()
                .summary
                .unwrap();

        let second = gen_chain(&["show.example.org"]);
        let (cert2, key2) = write_import_files(root.path(), &second, "b");
        import_material(
            root.path(),
            "show.example.org",
            &cert2,
            &key2,
            &second.anchors,
            now(),
        )
        .expect("second import");

        let second_summary = summarize_stored(
            root.path(),
            Some("show.example.org"),
            &second.anchors,
            now(),
        )
        .unwrap()
        .unwrap()
        .summary
        .unwrap();
        assert_ne!(first_summary.fingerprint, second_summary.fingerprint);
    }

    #[test]
    fn stored_material_revalidates_against_the_current_domain() {
        let root = tempfile::tempdir().expect("root");
        let chain = gen_chain(&["show.example.org"]);
        let (cert, key) = write_import_files(root.path(), &chain, "a");
        import_material(
            root.path(),
            "show.example.org",
            &cert,
            &key,
            &chain.anchors,
            now(),
        )
        .expect("import");

        let state = summarize_stored(
            root.path(),
            Some("renamed.example.org"),
            &chain.anchors,
            now(),
        )
        .unwrap()
        .expect("stored");
        assert_eq!(state.problems.len(), 1);
        assert_eq!(state.problems[0].code, HttpsProblemCode::DomainMismatch);
        let summary = state.summary.expect("summary");
        assert_eq!(summary.status, HttpsCertificateStatus::WrongDomain);
        // The summary keeps showing the material's own facts.
        assert_eq!(summary.sans, vec!["show.example.org".to_string()]);
    }

    #[test]
    fn import_rejects_an_invalid_domain_without_storing() {
        let root = tempfile::tempdir().expect("root");
        let chain = gen_chain(&["show.example.org"]);
        let (cert, key) = write_import_files(root.path(), &chain, "a");
        let outcome = import_material(
            root.path(),
            "192.168.1.5",
            &cert,
            &key,
            &chain.anchors,
            now(),
        )
        .expect("import io");
        assert!(outcome.summary.is_none());
        assert_eq!(outcome.problems[0].code, HttpsProblemCode::DomainMismatch);
        assert!(!material_path(root.path()).exists());
    }
}
