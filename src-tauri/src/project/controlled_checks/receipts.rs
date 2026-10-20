//! Native completed-check evidence, independent of a live desktop task slot.
use super::ControlledCheckReport;
use std::ffi::CString;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_REPORT_BYTES: u64 = 64 * 1024 * 1024;

fn safe_task_id(task_id: &str) -> Result<CString, String> {
    if task_id.is_empty()
        || task_id.len() > 128
        || !task_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Invalid controlled-check receipt task ID".into());
    }
    Ok(CString::new(format!("{task_id}.json")).expect("validated task ID"))
}

fn open_directory(data: &Path, create: bool) -> Result<File, String> {
    let path = data.join("controlled-check-reports");
    if create {
        fs::create_dir_all(data).map_err(|_| "Cannot prepare private check receipt storage")?;
        match fs::DirBuilder::new().mode(0o700).create(&path) {
            Ok(()) => {}
            Err(cause) if cause.kind() == io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err("Cannot prepare private check receipt storage".into()),
        }
    }
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| "No private completed-check receipt exists")?;
    if create {
        directory
            .set_permissions(fs::Permissions::from_mode(0o700))
            .map_err(|_| "Cannot protect private check receipt storage")?;
    } else if directory
        .metadata()
        .map_err(|_| "Cannot inspect private check receipt storage")?
        .permissions()
        .mode()
        & 0o077
        != 0
    {
        return Err("Completed-check receipt storage is not private".into());
    }
    Ok(directory)
}

fn validate_owner(
    report: &ControlledCheckReport,
    source: &Path,
    task_id: &str,
) -> Result<(), String> {
    safe_task_id(task_id)?;
    let canonical = fs::canonicalize(source).map_err(|_| "Check receipt source is unavailable")?;
    let metadata = fs::metadata(&canonical).map_err(|_| "Cannot inspect check receipt source")?;
    let source_identity = format!("{}:{}", metadata.dev(), metadata.ino());
    let evidence = report
        .evidence
        .as_ref()
        .ok_or("No input evidence exists for this completed check")?;
    if report.schema_version != 1
        || report.checker_version != env!("CARGO_PKG_VERSION")
        || report.task_id != task_id
        || Path::new(&report.project_path) != canonical
        || Path::new(&evidence.source_root) != canonical
        || evidence.source_identity != source_identity
        || !metadata.is_dir()
    {
        return Err("Completed-check receipt belongs to another source, task or checker".into());
    }
    if !report.cleanup.node_confirmed
        || !report.cleanup.audio_confirmed
        || !report.cleanup.temporary_files_removed
    {
        return Err("Completed-check receipt cleanup was not confirmed".into());
    }
    Ok(())
}

/// Desktop calls this only after recording the runtime lease's cleanup result.
/// Failure leaves current in-memory evidence usable; restart schedules a fresh
/// check when no complete, trustworthy private receipt is available.
pub(crate) fn persist_report_receipt(
    data: &Path,
    report: &ControlledCheckReport,
) -> Result<(), String> {
    let name = safe_task_id(&report.task_id)?;
    validate_owner(report, Path::new(&report.project_path), &report.task_id)?;
    let bytes = serde_json::to_vec(report).map_err(|_| "Cannot encode completed-check receipt")?;
    if bytes.len() as u64 > MAX_REPORT_BYTES {
        return Err("Completed-check receipt is too large".into());
    }
    let directory = open_directory(data, true)?;
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let serial = SERIAL.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let temporary = CString::new(format!(".check-{pid}-{serial}")).expect("generated name");
    let directory_fd = directory.as_raw_fd();
    let fd = unsafe {
        libc::openat(
            directory_fd,
            temporary.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            0o600,
        )
    };
    if fd < 0 {
        return Err("Cannot stage private completed-check receipt".into());
    }
    let mut file = unsafe { File::from_raw_fd(fd) };
    let result = (|| {
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Cannot flush private completed-check receipt")?;
        if unsafe {
            libc::renameat(
                directory_fd,
                temporary.as_ptr(),
                directory_fd,
                name.as_ptr(),
            )
        } != 0
        {
            return Err("Cannot publish private completed-check receipt".into());
        }
        let _ = directory.sync_all();
        Ok(())
    })();
    if result.is_err() {
        unsafe { libc::unlinkat(directory_fd, temporary.as_ptr(), 0) };
    }
    result
}

/// Read-only fallback after restart: neither an execution grant nor the old
/// runtime/session state is reconstructed from the receipt.
pub(crate) fn load_report_receipt(
    data: &Path,
    source: &Path,
    task_id: &str,
) -> Result<ControlledCheckReport, String> {
    let name = safe_task_id(task_id)?;
    let directory = open_directory(data, false)?;
    let fd = unsafe {
        libc::openat(
            directory.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err("No readable private completed-check receipt exists".into());
    }
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot inspect completed-check receipt")?;
    if !metadata.is_file()
        || metadata.len() > MAX_REPORT_BYTES
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err("Invalid private completed-check receipt".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_REPORT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read completed-check receipt")?;
    if bytes.len() as u64 > MAX_REPORT_BYTES {
        return Err("Completed-check receipt is too large".into());
    }
    let report: ControlledCheckReport =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid completed-check receipt format")?;
    validate_owner(&report, source, task_id)?;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::check_evidence::prepare_snapshot;
    use crate::types::AudioMode;
    use std::os::unix::fs::symlink;
    use std::sync::atomic::AtomicBool;

    fn captured_report(source: &Path, task: &str) -> ControlledCheckReport {
        let source = fs::canonicalize(source).unwrap();
        let temporary = tempfile::tempdir().unwrap();
        let prepared = prepare_snapshot(
            &source,
            None,
            temporary.path(),
            &AtomicBool::new(false),
            |_, _| {},
        )
        .unwrap();
        let mut report =
            ControlledCheckReport::not_executed(task, &source, AudioMode::None, "fixture".into());
        report.evidence = Some(prepared.evidence);
        report
    }

    #[test]
    fn fallback_receipts_refuse_missing_unsafe_wrong_owner_and_unconfirmed_results() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("asset.bin"), "saved input").unwrap();
        let data = directory.path().join("data");
        let mut report = captured_report(&source, "app-1-123");
        assert!(load_report_receipt(&data, &source, &report.task_id).is_err());
        persist_report_receipt(&data, &report).unwrap();
        assert!(load_report_receipt(&data, &source, "../app-1-123").is_err());
        let other = directory.path().join("other");
        fs::create_dir(&other).unwrap();
        assert!(load_report_receipt(&data, &other, &report.task_id).is_err());
        report.cleanup.node_confirmed = false;
        assert!(persist_report_receipt(&data, &report).is_err());
        report.cleanup.node_confirmed = true;
        let old = source.with_file_name("old-source");
        fs::rename(&source, old).unwrap();
        fs::create_dir(&source).unwrap();
        fs::write(source.join("asset.bin"), "saved input").unwrap();
        assert!(load_report_receipt(&data, &source, &report.task_id).is_err());
    }

    #[test]
    fn fallback_receipts_are_bounded_private_and_never_follow_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("asset.bin"), "saved input").unwrap();
        let data = directory.path().join("data");
        let report = captured_report(&source, "app-1-123");
        persist_report_receipt(&data, &report).unwrap();
        let path = data.join("controlled-check-reports/app-1-123.json");
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(load_report_receipt(&data, &source, &report.task_id).is_ok());
        fs::write(&path, b"{incomplete").unwrap();
        assert!(load_report_receipt(&data, &source, &report.task_id).is_err());
        let mut unsupported = serde_json::to_value(&report).unwrap();
        unsupported["schemaVersion"] = serde_json::json!(2);
        fs::write(&path, unsupported.to_string()).unwrap();
        assert!(load_report_receipt(&data, &source, &report.task_id).is_err());
        File::create(&path)
            .unwrap()
            .set_len(MAX_REPORT_BYTES + 1)
            .unwrap();
        assert!(load_report_receipt(&data, &source, &report.task_id).is_err());
        persist_report_receipt(&data, &report).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(load_report_receipt(&data, &source, &report.task_id).is_err());
        fs::rename(&path, path.with_extension("backup")).unwrap();
        symlink(path.with_extension("backup"), &path).unwrap();
        assert!(load_report_receipt(&data, &source, &report.task_id).is_err());
        fs::rename(data.join("controlled-check-reports"), data.join("outside")).unwrap();
        symlink(data.join("outside"), data.join("controlled-check-reports")).unwrap();
        assert!(load_report_receipt(&data, &source, &report.task_id).is_err());
        assert!(persist_report_receipt(&data, &report).is_err());
    }
}
