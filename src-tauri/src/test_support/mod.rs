//! Shared support for real local fixtures, compiled only into library tests.

mod local_fixture;

pub(crate) use local_fixture::{FixturePorts, OwnedNodeFixture};
