//! PNDS 后台 LAN DNS 守护进程（LaunchDaemon 侧）。
//!
//! 分层：[`engine`] 查询管线（映射合成 / 转发 / 缓存），[`control`]
//! Unix socket 控制面（App ↔ 守护进程，按对端 uid 鉴权），[`state`]
//! 持久化（上游与已知演出域名），[`server`] UDP/TCP 53 监听循环与租约
//! 巡检。独立于 App crate——守护进程二进制不链接任何 App 代码。

pub mod control;
pub mod engine;
pub mod server;
pub mod state;

use engine::Engine;
use std::net::{SocketAddr, TcpListener, UdpSocket};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// 默认状态文件（由 launchd 的 root 身份创建、仅 root 可写）。
fn default_state_path() -> PathBuf {
    PathBuf::from("/Library/Application Support/PNDS/dnsd/state.json")
}

/// 默认控制 socket 路径。
fn default_control_path() -> PathBuf {
    PathBuf::from("/Library/Application Support/PNDS/dnsd/control.sock")
}

/// 手写参数解析（守护进程不引 clap）：`--state <path> --control <path>
/// --port <u16> [--upstream <ip[:port]>]...`。缺失项取默认；--port 仅
/// 测试用（生产固定 53）。
fn parse_args(args: Vec<String>) -> (PathBuf, PathBuf, u16, Vec<SocketAddr>) {
    let mut state_path = default_state_path();
    let mut control_path = default_control_path();
    let mut port = 53u16;
    let mut upstreams = Vec::new();
    let mut iter = args.into_iter();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--state" => state_path = iter.next().map(PathBuf::from).unwrap_or(state_path),
            "--control" => control_path = iter.next().map(PathBuf::from).unwrap_or(control_path),
            "--port" => {
                port = iter.next().and_then(|p| p.parse().ok()).unwrap_or(port);
            }
            "--upstream" => {
                if let Some(text) = iter.next() {
                    if let Some(addr) = server::parse_upstream(&text) {
                        upstreams.push(addr);
                    }
                }
            }
            _ => {}
        }
    }
    (state_path, control_path, port, upstreams)
}

/// 守护进程主体：加载状态 → 构建引擎 → 起监听与控制面 → 等待停止
/// 信号（控制面 stop；launchd 停止走 SIGTERM 直接终止，无状态需清理——
/// state 文件随每次变更即时落盘）。
pub fn run() -> ExitCode {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info"))
        .format_timestamp_secs()
        .init();
    let (state_path, control_path, port, arg_upstreams) =
        parse_args(std::env::args().skip(1).collect());

    let persisted = state::load(&state_path);
    let upstreams: Vec<SocketAddr> = arg_upstreams
        .iter()
        .copied()
        .chain(
            persisted
                .upstreams
                .iter()
                .filter_map(|s| server::parse_upstream(s)),
        )
        .collect();
    let engine = Arc::new(Engine::new(
        upstreams.clone(),
        persisted.known_domains.clone(),
        Box::new(Instant::now),
    ));

    let stop = Arc::new(AtomicBool::new(false));

    // 监听固定的操作者选定地址（spec #174）：state 里存的 LAN 地址，
    // 缺省/失效（网络变了）时退回全接口——退回是如实的降级，不是猜测。
    let bind_host: std::net::IpAddr = persisted
        .listen_ip
        .as_deref()
        .and_then(|text| text.parse().ok())
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED));
    let bind_addr = std::net::SocketAddr::new(bind_host, port);

    // 53 端口被占用（或其他绑定失败）是**明确结果**而非静默重启循环：
    // 记录原因，继续起控制面——App 的启用流程据此给出可行动文案；
    // launchd 的 KeepAlive 拉起后同样稳定停留在这个状态。
    let listeners = server::Listeners::new();
    let udp = UdpSocket::bind(bind_addr);
    let tcp = TcpListener::bind(bind_addr);
    let bind_error = udp
        .as_ref()
        .err()
        .map(|e| e.to_string())
        .or_else(|| tcp.as_ref().err().map(|e| e.to_string()));
    let (udp, tcp) = (udp.ok(), tcp.ok());
    if udp.is_none() || tcp.is_none() {
        let reason = bind_error.unwrap_or_else(|| "port 53 unavailable".to_string());
        log::error!("cannot bind UDP/TCP {bind_addr}: {reason}");
        *listeners.bind_error.lock().unwrap() = Some(reason);
    }
    let (bound_udp, bound_tcp) = (udp.is_some(), tcp.is_some());
    let udp_handle = udp.map(|socket| {
        server::serve_udp(
            Arc::clone(&engine),
            socket,
            Arc::clone(&stop),
            Arc::clone(&listeners),
        )
    });
    let tcp_handle = tcp.map(|listener| {
        server::serve_tcp(
            Arc::clone(&engine),
            listener,
            Arc::clone(&stop),
            Arc::clone(&listeners),
        )
    });
    let reaper = server::spawn_lease_reaper(Arc::clone(&engine), Arc::clone(&stop));

    let control_engine = Arc::clone(&engine);
    let control_stop = Arc::clone(&stop);
    let state_engine = Arc::clone(&engine);
    // config.set / mapping.set 后同步落盘：包装一层轮询线程不值得——
    // 控制面直接改引擎，落盘交给一个低频巡检线程（1s）对比快照。
    let restart = Arc::new(AtomicBool::new(false));
    let control = control::serve(
        control_engine,
        Arc::clone(&listeners),
        &control_path,
        state_path.clone(),
        Arc::clone(&restart),
        control_stop,
    );
    if let Err(e) = control {
        log::error!("control plane failed to start: {e}");
        return ExitCode::from(1);
    }
    if bound_udp && bound_tcp {
        log::info!(
            "dnsd listening on {bind_addr} (UDP/TCP {port}), control at {}, {} upstream(s)",
            control_path.display(),
            upstreams.len()
        );
    } else {
        log::warn!(
            "dnsd control plane at {} (port 53 NOT bound: see status bindError), {} upstream(s)",
            control_path.display(),
            upstreams.len()
        );
    }

    // 状态巡检：租约到期之外，把引擎的 upstreams/knownDomains 与磁盘
    // 记录同步（config.set 与 mapping 安装都会改变引擎）。
    while !stop.load(Ordering::SeqCst) && !restart.load(Ordering::SeqCst) {
        std::thread::sleep(std::time::Duration::from_millis(200));
        let persisted_now = state::from_engine(&state_engine);
        if persisted.upstreams != persisted_now.upstreams
            || persisted.known_domains != persisted_now.known_domains
        {
            if let Err(e) = state::save(&state_path, &persisted_now) {
                log::warn!("state save failed: {e}");
            }
        }
    }

    if let Some(handle) = udp_handle {
        handle.join().ok();
    }
    if let Some(handle) = tcp_handle {
        handle.join().ok();
    }
    reaper.join().ok();
    if restart.load(Ordering::SeqCst) {
        // launchd KeepAlive relaunches immediately; the next boot binds
        // the newly persisted fixed address.
        log::info!("dnsd restarting to apply the new listen address");
        return ExitCode::SUCCESS;
    }
    log::info!("dnsd stopped");
    ExitCode::SUCCESS
}
