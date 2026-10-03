//! dnsd 入口：见 lib.rs `run()`。

fn main() -> std::process::ExitCode {
    pnds_dnsd_lib::run()
}
