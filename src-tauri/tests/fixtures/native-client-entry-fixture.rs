#[cfg(target_os = "macos")]
fn main() {
    pnds_app_lib::run_native_client_entry_fixture();
}
#[cfg(not(target_os = "macos"))]
fn main() {
    panic!("This opt-in fixture requires macOS");
}
