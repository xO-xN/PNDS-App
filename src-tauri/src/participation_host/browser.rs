//! Ordinary-browser entry. Each confirmed URL is immutable for one performance;
//! cookies and later confirmations never authorize an older document.
use super::*;

fn html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn document(body: String) -> Route {
    let body = Full::new(Bytes::from(body))
        .map_err(|never| match never {})
        .boxed();
    Route::Reply(
        Response::builder()
            .header("content-type", "text/html; charset=utf-8")
            .header("cache-control", "no-store")
            .header("referrer-policy", "no-referrer")
            .body(body)
            .expect("browser entry response"),
    )
}

// Substitute only tokens from the bundled source, never tokens inside Host text.
fn page_template(source: &str, replacements: &[(&str, String)]) -> String {
    let mut parts = source.split("{{");
    let mut page = parts.next().unwrap_or_default().to_owned();
    for part in parts {
        let (key, tail) = part.split_once("}}").expect("browser entry template token");
        let value = &replacements
            .iter()
            .find(|(name, _)| *name == key)
            .expect("browser entry template value")
            .1;
        page.push_str(value);
        page.push_str(tail);
    }
    page
}

pub(super) fn landing(info: &HostInfo, headers: &hyper::HeaderMap) -> Route {
    let chinese = headers
        .get("accept-language")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("zh"));
    let strings: serde_json::Value = serde_json::from_str(if chinese {
        include_str!("../../../locales/zh-CN.json")
    } else {
        include_str!("../../../locales/en.json")
    })
    .expect("bundled browser translations");
    let text = |key: &str| {
        html(
            strings[format!("browserEntry.{key}")]
                .as_str()
                .expect("browser translation"),
        )
    };
    let host = html(&info.node_name);
    let stage = include_str!("../../resources/browser-participation/entry-gesture.html")
        .replace("{{GESTURE_LABEL}}", &text("gestureLabel"))
        .replace("{{LOADING}}", &text("loading"));
    let (state, project, performance, status, controls) = match &info.performance {
        None => (
            "waiting",
            String::new(),
            String::new(),
            String::new(),
            String::new(),
        ),
        Some(run) => {
            let project = html(&run.project_name);
            let performance = html(&run.performance_id);
            if run.browser_participation == Some(1) {
                let action = confirmation_path(info, run);
                (
                    "ready",
                    project,
                    performance,
                    String::new(),
                    format!(
                        r#"<form method="post" action="{action}" data-pnds-enter-form>{stage}</form>"#
                    ),
                )
            } else {
                (
                    "adaptationRequired",
                    project,
                    performance,
                    text("adaptationRequired"),
                    String::new(),
                )
            }
        }
    };
    let copy: serde_json::Map<String, serde_json::Value> = strings
        .as_object()
        .expect("locale object")
        .iter()
        .filter_map(|(key, value)| {
            key.strip_prefix("browserEntry.")
                .map(|short| (short.to_owned(), value.clone()))
        })
        .collect();
    let bootstrap = serde_json::json!({"hostId": info.host_id, "info": info, "strings": copy})
        .to_string()
        .replace('<', r"\u003c");
    let language = if chinese { "zh-CN" } else { "en" };
    let replacements = [
        ("LANGUAGE", language.to_owned()),
        ("TITLE", text("title")),
        ("HOST", host),
        ("BRAND", text("brand")),
        ("CONNECTED", text("connected")),
        ("WAITING", text("waiting")),
        ("WAITING_HINT", text("waitingHint")),
        ("ACTION_LABEL", text("firstReady")),
        ("PROJECT", project),
        ("PERFORMANCE", performance),
        ("STATE", state.to_owned()),
        (
            "READY_CLASS",
            if state == "ready" { "is-ready" } else { "" }.to_owned(),
        ),
        ("STATUS", status),
        ("CONTROLS", controls),
        ("INSTRUCTION", text("pullFirst")),
        ("KEY_HINT", text("keyHint")),
        ("SAVE_TITLE", text("saveTitle")),
        ("SAVE_HINT", text("saveHint")),
        ("SAVE_NOTE", text("saveNote")),
        ("GESTURE_TEMPLATE", stage),
        ("CONTEXT", bootstrap),
    ];
    document(page_template(
        include_str!("../../resources/browser-participation/entry.html"),
        &replacements,
    ))
}

fn confirmation_path(info: &HostInfo, run: &HostPerformance) -> String {
    format!(
        "/__pnds/enter/{}/{}/{}",
        info.host_id, run.project_id, run.performance_id
    )
}

pub(super) fn context(info: &HostInfo, prefix: &str) -> Route {
    let run = info.performance.as_ref().expect("confirmed performance");
    let value = serde_json::json!({
        "protocolVersion": 1, "hostId": info.host_id, "projectId": run.project_id,
        "performanceId": run.performance_id, "basePath": prefix,
        "storagePrefix": format!("pnds:{}:{}:", info.host_id, run.project_id),
    });
    let script = include_str!("../../resources/browser-participation/context.js")
        .replace("__PNDS_CONTEXT__", &value.to_string());
    let body = Full::new(Bytes::from(script))
        .map_err(|never| match never {})
        .boxed();
    Route::Reply(
        Response::builder()
            .header("content-type", "text/javascript; charset=utf-8")
            .header("cache-control", "no-store")
            .body(body)
            .expect("browser context response"),
    )
}

pub(super) fn route(state: &mut EntryState, request: &mut Request<Incoming>) -> Option<Route> {
    let path = request.uri().path();
    if path == "/__pnds/entry.webmanifest" {
        let manifest = serde_json::json!({
            "id": "/", "start_url": "/", "scope": "/",
            "name": format!("PNDS池谱 · {}", state.info.node_name),
            "short_name": "PNDS池谱", "display": "standalone",
            "icons": [{"src": "/__pnds/icon.png", "sizes": "512x512", "type": "image/png"}],
        });
        return Some(asset(
            "application/manifest+json; charset=utf-8",
            manifest.to_string().as_bytes(),
        ));
    }
    let asset = match path {
        "/__pnds/entry-gesture.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../resources/browser-participation/entry-gesture.js").as_slice(),
        )),
        "/__pnds/brand.png" => Some((
            "image/png",
            include_bytes!("../../../assets/pnds-icon.png").as_slice(),
        )),
        "/__pnds/fonts/manrope-latin.woff2" => Some((
            "font/woff2",
            include_bytes!("../../../public/fonts/manrope-latin.woff2").as_slice(),
        )),
        "/__pnds/fonts/comfortaa-latin.woff2" => Some((
            "font/woff2",
            include_bytes!("../../../public/fonts/comfortaa-latin.woff2").as_slice(),
        )),
        "/__pnds/entry.js" => Some((
            "text/javascript; charset=utf-8",
            include_bytes!("../../resources/browser-participation/entry.js").as_slice(),
        )),
        "/__pnds/entry.css" => Some((
            "text/css; charset=utf-8",
            include_bytes!("../../resources/browser-participation/entry.css").as_slice(),
        )),
        "/__pnds/icon.png" => Some((
            "image/png",
            include_bytes!("../../icons/icon.png").as_slice(),
        )),
        _ => None,
    };
    if let Some((content_type, source)) = asset {
        return Some(self::asset(content_type, source));
    }
    if path.starts_with("/__pnds/enter/") {
        if request.method() != Method::POST {
            return Some(reply(
                StatusCode::METHOD_NOT_ALLOWED,
                serde_json::json!({"error":"confirmationRequiresPost"}),
            ));
        }
        let valid = state.info.performance.as_ref().is_some_and(|run| {
            run.browser_participation == Some(1) && path == confirmation_path(&state.info, run)
        });
        if !valid {
            return Some(reply(
                StatusCode::CONFLICT,
                serde_json::json!({"error":"participationChanged"}),
            ));
        }
        if state.browser_grant.is_none() {
            match random_id() {
                Ok(grant) => state.browser_grant = Some(grant),
                Err(_) => {
                    return Some(reply(
                        StatusCode::SERVICE_UNAVAILABLE,
                        serde_json::json!({"error":"entryUnavailable"}),
                    ))
                }
            }
        }
        let grant = state.browser_grant.as_ref().expect("confirmed grant");
        return Some(Route::Reply(
            Response::builder()
                .status(StatusCode::SEE_OTHER)
                .header("location", format!("/__pnds/run/{grant}/"))
                .header("cache-control", "no-store")
                .header("referrer-policy", "no-referrer")
                .body(
                    Full::new(Bytes::new())
                        .map_err(|never| match never {})
                        .boxed(),
                )
                .expect("confirmed browser redirect"),
        ));
    }
    if !path.starts_with("/__pnds/run/") {
        return None;
    }
    let Some(grant) = &state.browser_grant else {
        return Some(reply(
            StatusCode::CONFLICT,
            serde_json::json!({"error":"participationChanged"}),
        ));
    };
    let prefix = format!("/__pnds/run/{grant}/");
    let Some(relative) = path.strip_prefix(&prefix) else {
        return Some(reply(
            StatusCode::CONFLICT,
            serde_json::json!({"error":"participationChanged"}),
        ));
    };
    if relative == "__pnds/context.js" {
        return Some(context(&state.info, &prefix));
    }
    let path_query = match request.uri().query() {
        Some(query) => format!("/{relative}?{query}"),
        None => format!("/{relative}"),
    };
    *request.uri_mut() = path_query
        .parse()
        .expect("already parsed browser path and query");
    Some(match state.upstream {
        Some(upstream) => Route::Forward(upstream),
        None => reply(
            StatusCode::GONE,
            serde_json::json!({"error":"performanceEnded"}),
        ),
    })
}

fn asset(content_type: &str, source: &[u8]) -> Route {
    Route::Reply(
        Response::builder()
            .header("content-type", content_type)
            .header("cache-control", "no-store")
            .body(
                Full::new(Bytes::copy_from_slice(source))
                    .map_err(|never| match never {})
                    .boxed(),
            )
            .expect("browser entry asset"),
    )
}
