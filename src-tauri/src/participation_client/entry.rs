//! Candidate preparation owns a second source; only an exact, prepared candidate
//! may exchange documents. The loaded source and page epoch stay pinned meanwhile.
use super::*;

pub(super) struct PendingEntry {
    pub(super) target: ClientPageTarget,
    host: ClientHostInfo,
    pub(super) proxy: ClientProxy,
}
impl ClientCoordinator {
    pub(crate) fn set_view_prepare(&self, prepare: ViewPrepare) {
        *self.view_prepare.lock().unwrap() = Some(prepare);
    }
    pub(crate) fn set_view_commit(&self, commit: ViewTransition) {
        *self.view_commit.lock().unwrap() = Some(commit);
    }
    pub(crate) fn set_view_cancel(&self, cancel: ViewTransition) {
        *self.view_cancel.lock().unwrap() = Some(cancel);
    }
    pub(crate) fn entry_host(&self, target: &ClientPageTarget) -> Option<ClientHostInfo> {
        self.inner
            .lock()
            .unwrap()
            .pending
            .as_ref()
            .filter(|pending| pending.target.page_url == target.page_url)
            .map(|pending| pending.host.clone())
    }
    pub(crate) fn entry_matches(&self, target: &ClientPageTarget) -> bool {
        let state = self.inner.lock().unwrap();
        state.epoch == target.epoch
            && state
                .pending
                .as_ref()
                .is_some_and(|pending| pending.target.page_url == target.page_url)
    }
    pub fn cancel_entry(&self) -> ClientSnapshot {
        self.cancel_entry_for(None, None, None)
    }
    fn cancel_entry_for(
        &self,
        expected: Option<&ClientPageTarget>,
        failure: Option<ClientError>,
        latest: Option<ClientHostInfo>,
    ) -> ClientSnapshot {
        let (epoch, target) = {
            let mut state = self.inner.lock().unwrap();
            if state.committing
                || expected.is_some_and(|expected| {
                    !state.pending.as_ref().is_some_and(|pending| {
                        pending.target.epoch == expected.epoch
                            && pending.target.page_url == expected.page_url
                    })
                })
            {
                return state.public_snapshot();
            }
            state.committing = true;
            state.epoch = state.epoch.wrapping_add(1);
            (
                state.epoch,
                state.pending.as_ref().map(|pending| pending.target.clone()),
            )
        };
        let cancel = self.view_cancel.lock().unwrap().clone();
        let cleanup = target.map_or(Ok(()), |target| {
            cancel.map_or(Ok(()), |cancel| cancel(target))
        });
        let mut state = self.inner.lock().unwrap();
        if state.epoch != epoch {
            return state.public_snapshot();
        }
        state.committing = false;
        if let Err(error) = cleanup {
            state.snapshot.phase = ClientPhase::CleanupFailed;
            state.snapshot.error =
                Some(format!("participation.errors.cleanupFailed: {error}").into());
        } else {
            if let Some(mut pending) = state.pending.take() {
                if let Err(error) = pending.proxy.shutdown() {
                    state.retired.push(pending.proxy);
                    state.snapshot.error = Some(error.into());
                    state.snapshot.phase = ClientPhase::CleanupFailed;
                    state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
                    drop(state);
                    return self.publish();
                }
            }
            let resume_phase = state.entry_resume_phase.take();
            if matches!(
                state.snapshot.phase,
                ClientPhase::Connecting | ClientPhase::CleanupFailed
            ) || failure.is_some()
            {
                state.snapshot.phase = resume_phase.clone().unwrap_or_else(|| retry_phase(&state));
                state.snapshot.error = failure;
            }
            if let Some(host) = latest.filter(|_| resume_phase.is_none()) {
                state.snapshot.host = Some(host);
            }
        }
        state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        drop(state);
        self.publish()
    }
    pub async fn enter(
        &self,
        data_dir: &Path,
        expected: ClientHostInfo,
    ) -> Result<ClientSnapshot, String> {
        self.enter_candidate(data_dir, expected, None, || false)
            .await
    }

    pub(crate) async fn enter_at(
        &self,
        data_dir: &Path,
        address: &str,
        expected: ClientHostInfo,
        host_active: impl FnOnce() -> bool,
    ) -> Result<ClientSnapshot, String> {
        self.enter_candidate(
            data_dir,
            expected,
            Some(parse_address(address)?),
            host_active,
        )
        .await
    }

    async fn enter_candidate(
        &self,
        data_dir: &Path,
        expected: ClientHostInfo,
        endpoint: Option<(String, SocketAddr)>,
        host_active: impl FnOnce() -> bool,
    ) -> Result<ClientSnapshot, String> {
        let (epoch, address, target) = {
            let _admission = ROLE_ADMISSION.lock().unwrap();
            if host_active() {
                return Err("participation.errors.hostActive".into());
            }
            let mut state = self.inner.lock().unwrap();
            if state.committing
                || state.pending.is_some()
                || matches!(
                    state.snapshot.phase,
                    ClientPhase::Inspecting
                        | ClientPhase::Connecting
                        | ClientPhase::Leaving
                        | ClientPhase::CleanupFailed
                )
            {
                return Err("participation.errors.leaveFirst".into());
            }
            let (address, target) = match endpoint {
                Some(endpoint) => endpoint,
                None => {
                    let candidate = state
                        .snapshot
                        .host
                        .as_ref()
                        .ok_or("participation.errors.confirmFirst")?;
                    if !same_context(&expected, candidate) {
                        return Err("participation.errors.changed".into());
                    }
                    (
                        state
                            .snapshot
                            .address
                            .clone()
                            .ok_or("participation.errors.invalidAddress")?,
                        state.target.ok_or("participation.errors.invalidAddress")?,
                    )
                }
            };
            if !expected
                .performance
                .as_ref()
                .is_some_and(|performance| performance.supports_performer_url)
            {
                return Err("participation.errors.adaptation".into());
            }
            if state.target != Some(target) {
                state.entry_resume_phase = Some(state.snapshot.phase.clone());
            }
            state.epoch = state.epoch.wrapping_add(1);
            state.snapshot.phase = ClientPhase::Connecting;
            state.snapshot.error = None;
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
            (state.epoch, address, target)
        };
        self.publish();
        let latest = fetch_host(&address, target).await;
        let prepared = {
            let mut state = self.inner.lock().unwrap();
            if state.epoch != epoch {
                return Ok(state.public_snapshot());
            }
            match latest {
                Ok(host) if same_context(&expected, &host) => {
                    match ClientProxy::start(data_dir, target, &host) {
                        Ok(proxy) => {
                            let page_url = format!(
                                "http://{}:{}/?pndsClientPass={epoch}",
                                proxy.hostname, proxy.origin_port
                            );
                            state.pending = Some(PendingEntry {
                                target: ClientPageTarget {
                                    epoch,
                                    page_url,
                                    proxy_address: proxy.address,
                                    controller_scope: ControllerScope::client(&host),
                                },
                                host,
                                proxy,
                            });
                        }
                        Err(error) => {
                            fail_entry(&mut state, error.into());
                        }
                    }
                }
                Ok(host) => {
                    if state.entry_resume_phase.is_none() {
                        state.snapshot.host = Some(host);
                    }
                    fail_entry(&mut state, "participation.errors.changed".into());
                }
                Err(error) => fail_entry(&mut state, error.to_string().into()),
            }
            if state.pending.is_none() {
                drop(state);
                return Ok(self.publish());
            }
            state.pending.as_ref().unwrap().target.clone()
        };
        let prepare = self.view_prepare.lock().unwrap().clone();
        let preparation = match prepare {
            Some(prepare) => prepare(prepared.clone()).await,
            None => Err("participation.errors.scoreView: Native preparation is unavailable".into()),
        };
        if !self.entry_matches(&prepared) {
            return Ok(self.snapshot());
        }
        if let Err(error) = preparation {
            return Ok(self.cancel_entry_for(Some(&prepared), Some(error.into()), None));
        }
        // Loading can take time. A click for B may never be reused for C.
        let latest = fetch_host(&address, target).await;
        if !self.entry_matches(&prepared) {
            return Ok(self.snapshot());
        }
        match latest {
            Ok(host) if same_context(&expected, &host) => {}
            other => {
                return Ok(match other {
                    Ok(host) => self.cancel_entry_for(
                        Some(&prepared),
                        Some("participation.errors.changed".into()),
                        Some(host),
                    ),
                    Err(error) => {
                        self.cancel_entry_for(Some(&prepared), Some(error.to_string().into()), None)
                    }
                });
            }
        }

        {
            let mut state = self.inner.lock().unwrap();
            if state.epoch != prepared.epoch {
                return Ok(state.public_snapshot());
            }
            state.committing = true;
        }
        let commit = self.view_commit.lock().unwrap().clone();
        let result = commit.map_or_else(
            || Err("participation.errors.scoreView: Native handoff is unavailable".into()),
            |commit| commit(prepared.clone()),
        );
        let mut state = self.inner.lock().unwrap();
        if state.epoch != prepared.epoch {
            return Ok(state.public_snapshot());
        }
        state.committing = false;
        if let Err(error) = result {
            // Commit may have an unfinished old-store flush. Keep both source
            // owners until Leave/cancel confirms their cleanup.
            state.handoff_failed = true;
            state.snapshot.phase = ClientPhase::CleanupFailed;
            state.snapshot.error =
                Some(format!("participation.errors.cleanupFailed: {error}").into());
            state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
            drop(state);
            return Ok(self.publish());
        }
        let pending = state.pending.take().ok_or("participation.errors.changed")?;
        if let Some(mut old) = state.proxy.take() {
            old.set_admission(false);
            if old.shutdown().is_err() {
                state.retired.push(old);
            }
        }
        state.snapshot.page_url = Some(pending.target.page_url);
        state.snapshot.address = Some(address);
        state.target = Some(target);
        state.page_epoch = pending.target.epoch;
        state.snapshot.expected_host_id = Some(pending.host.host_id.clone());
        state.confirmed = Some(pending.host.clone());
        state.snapshot.host = Some(pending.host);
        state.context_revoked = false;
        state.handoff_failed = false;
        state.entry_resume_phase = None;
        state.proxy = Some(pending.proxy);
        state.snapshot.phase = ClientPhase::Open;
        state.snapshot.error = None;
        state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
        drop(state);
        Ok(self.publish())
    }
}
fn fail_entry(state: &mut ClientState, error: ClientError) {
    state.snapshot.phase = state
        .entry_resume_phase
        .take()
        .unwrap_or_else(|| retry_phase(state));
    state.snapshot.error = Some(error);
    state.snapshot.revision = state.snapshot.revision.wrapping_add(1);
}

fn retry_phase(state: &ClientState) -> ClientPhase {
    if state.snapshot.page_url.is_some() {
        ClientPhase::Changed
    } else {
        ClientPhase::Confirm
    }
}
