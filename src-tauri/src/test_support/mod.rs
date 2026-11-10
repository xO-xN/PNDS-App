//! Shared support for real local fixtures, compiled only into library tests.

mod local_fixture;
mod tcp_diagnostics;
mod tcp_ranges;

pub(crate) use local_fixture::{FixturePorts, OwnedNodeFixture};

pub(crate) use tcp_diagnostics::tcp_endpoint_snapshot;
pub(crate) use tcp_ranges::{run_isolated_test, wait_for_tcp_listener_release};
