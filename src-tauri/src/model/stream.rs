//! Bounded Chat Completions SSE decoding. Public text can be previewed while
//! fragmented tool arguments still require a complete turn for validation.
use super::{provider, transport, ModelServiceError};
use serde_json::{json, Value};
use std::collections::BTreeMap;

mod public_tool_text;
use public_tool_text::PublicToolText;

const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_TEXT_BYTES: usize = 64 * 1024;

pub(super) async fn request(
    client: &reqwest::Client,
    endpoint: &str,
    key: &str,
    body: Value,
    mut on_text: impl FnMut(&str) + Send,
) -> Result<Value, ModelServiceError> {
    let retain_reasoning = provider::is_deepseek(endpoint);
    let mut decoder = Decoder::for_request(&body, retain_reasoning);
    let mut response = transport::response(client, endpoint, key, body, true).await?;
    let streaming = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|header| header.to_str().ok())
        .is_some_and(|value| {
            value
                .split(';')
                .next()
                .is_some_and(|mime| mime.trim().eq_ignore_ascii_case("text/event-stream"))
        });
    // Some compatible services ignore stream=true. Consume this very response;
    // never retry a paid request merely to negotiate its representation.
    if !streaming {
        let message = transport::read_message(response, retain_reasoning).await?;
        if let Some(text) = message["content"].as_str().filter(|text| !text.is_empty()) {
            on_text(text);
        }
        return Ok(message);
    }
    while let Some(chunk) = response.chunk().await.map_err(transport::transport_error)? {
        decoder.push(&chunk, &mut on_text)?;
        if decoder.done {
            return decoder.message();
        }
    }
    // A closed body without the terminator is incomplete, even after some text.
    log::warn!("[model-stream] rejected reason=missing_terminator");
    Err(ModelServiceError::ResponseInterrupted)
}

#[derive(Default)]
struct Call {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Default)]
struct Decoder {
    pending: Vec<u8>,
    data: String,
    text: String,
    retain_reasoning: bool,
    reasoning: Option<String>,
    calls: BTreeMap<u64, Call>,
    public_tool_fields: Vec<(&'static str, &'static str)>,
    public_tool_preview: Option<(usize, PublicToolText)>,
    finished: bool,
    done: bool,
    usage: Option<Value>,
}

impl Decoder {
    fn for_request(body: &Value, retain_reasoning: bool) -> Self {
        let offers_tool = |name: &str| {
            body["tools"].as_array().is_some_and(|tools| {
                tools
                    .iter()
                    .any(|tool| tool["type"] == "function" && tool["function"]["name"] == name)
            })
        };
        // The legacy proposal mode offers propose_handoff too. Its presence
        // alone does not identify the terminal Discussion protocol.
        let discussion = offers_tool("complete_discussion");
        let public_tool_fields = [
            ("complete_discussion", "answer"),
            ("propose_handoff", "plan"),
        ]
        .into_iter()
        .filter(|(name, _)| discussion && offers_tool(name))
        .collect();
        Self {
            retain_reasoning,
            public_tool_fields,
            ..Self::default()
        }
    }

    fn refresh_public_tool_preview(&mut self) {
        let offered_call = self
            .calls
            .values()
            .next()
            .filter(|_| self.calls.len() == 1)
            .and_then(|call| {
                self.public_tool_fields
                    .iter()
                    .find(|(name, _)| *name == call.name)
                    .map(|(_, field)| (call, *field))
            });
        let Some((call, field)) = offered_call else {
            self.public_tool_preview = None;
            return;
        };
        let (parsed_bytes, parser) = self
            .public_tool_preview
            .get_or_insert_with(|| (0, PublicToolText::new(field)));
        parser.push(&call.arguments[*parsed_bytes..]);
        *parsed_bytes = call.arguments.len();
    }

    fn display_text(&self) -> (bool, &str) {
        if let Some(preview) = self
            .public_tool_preview
            .as_ref()
            .map(|(_, parser)| parser.text())
            .filter(|text| !text.is_empty())
        {
            (true, preview)
        } else {
            (false, &self.text)
        }
    }

    fn push(
        &mut self,
        bytes: &[u8],
        on_text: &mut impl FnMut(&str),
    ) -> Result<(), ModelServiceError> {
        // Bound retained/incomplete SSE events, not cumulative network bytes.
        // Metadata and ignored reasoning may span arbitrarily many valid frames.
        // Network chunk boundaries carry no protocol meaning: process complete
        // lines before accepting more bytes, even in a large coalesced chunk.
        for segment in bytes.split_inclusive(|byte| *byte == b'\n') {
            if self.pending.len() + self.data.len() + segment.len() > MAX_EVENT_BYTES {
                log::warn!(
                    "[model-stream] rejected reason=event_size_limit limit={MAX_EVENT_BYTES}"
                );
                return Err(ModelServiceError::ResponseTooLarge);
            }
            self.pending.extend_from_slice(segment);
            if segment.last() != Some(&b'\n') {
                continue;
            }
            let line =
                std::str::from_utf8(&self.pending).map_err(|_| ModelServiceError::Protocol)?;
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !self.data.is_empty() {
                    let data = std::mem::take(&mut self.data);
                    let (had_preview, previous_text) = self.display_text();
                    let previous = (had_preview, previous_text.len());
                    self.event(data.trim_end_matches('\n'))?;
                    self.refresh_public_tool_preview();
                    // A later malformed event can share this network chunk.
                    // Preserve each accepted prefix before parsing the next one.
                    let (has_preview, text) = self.display_text();
                    if (has_preview, text.len()) != previous {
                        on_text(text);
                    }
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
                self.data.push('\n');
            }
            self.pending.clear();
        }
        Ok(())
    }

    fn event(&mut self, data: &str) -> Result<(), ModelServiceError> {
        if data == "[DONE]" && self.finished && !self.done {
            self.done = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).map_err(|_| {
            log::warn!("[model-stream] rejected reason=invalid_json");
            ModelServiceError::Protocol
        })?;
        if self.done {
            return Err(ModelServiceError::Protocol);
        }
        if value.get("error").is_some() {
            return Err(transport::structured_error(&value).unwrap_or(ModelServiceError::Protocol));
        }
        if let Some(usage) = value.get("usage").filter(|usage| !usage.is_null()) {
            self.usage = Some(usage.clone());
        }
        let choices = value["choices"]
            .as_array()
            .ok_or(ModelServiceError::Protocol)?;
        if choices.is_empty() && value.get("usage").is_some() {
            return Ok(());
        }
        if choices.len() != 1 || choices[0]["index"] != 0 || self.finished {
            return Err(ModelServiceError::Protocol);
        }
        let delta = choices[0]["delta"]
            .as_object()
            .ok_or(ModelServiceError::Protocol)?;
        if delta
            .get("role")
            .is_some_and(|role| !role.is_null() && role != "assistant")
        {
            return Err(ModelServiceError::Protocol);
        }
        append(&mut self.text, delta.get("content"), MAX_TEXT_BYTES)?;
        if self.retain_reasoning
            && delta
                .get("reasoning_content")
                .is_some_and(|value| !value.is_null())
        {
            append(
                self.reasoning.get_or_insert_with(String::new),
                delta.get("reasoning_content"),
                provider::MAX_REASONING_BYTES,
            )?;
        }
        if let Some(calls) = delta.get("tool_calls").filter(|value| !value.is_null()) {
            for call in calls.as_array().ok_or(ModelServiceError::Protocol)? {
                let index = call["index"]
                    .as_u64()
                    .filter(|index| *index < 8)
                    .ok_or(ModelServiceError::Protocol)?;
                if call
                    .get("type")
                    .is_some_and(|kind| !kind.is_null() && kind != "function")
                {
                    return Err(ModelServiceError::Protocol);
                }
                let target = self.calls.entry(index).or_default();
                append(&mut target.id, call.get("id"), 256)?;
                if let Some(function) = call.get("function").filter(|value| !value.is_null()) {
                    let function = function.as_object().ok_or(ModelServiceError::Protocol)?;
                    append(&mut target.name, function.get("name"), 128)?;
                    append(&mut target.arguments, function.get("arguments"), 256 * 1024)?;
                }
            }
        }
        if let Some(finish) = choices[0]
            .get("finish_reason")
            .filter(|value| !value.is_null())
        {
            let expected = if self.calls.is_empty() {
                "stop"
            } else {
                "tool_calls"
            };
            if finish != expected {
                return Err(transport::finish_failure(finish));
            }
            self.finished = true;
        }
        Ok(())
    }

    fn message(self) -> Result<Value, ModelServiceError> {
        if !self.finished || !self.done {
            return Err(ModelServiceError::ResponseInterrupted);
        }
        let mut message = json!({
            "role": "assistant",
            "usage": self.usage,
            "content": self.text,
            "tool_calls": self.calls.into_values().map(|call| json!({
                "id":call.id, "type":"function", "function":{"name":call.name,"arguments":call.arguments}
            })).collect::<Vec<_>>()
        });
        if let Some(reasoning) = self.reasoning {
            message["reasoning_content"] = json!(reasoning);
        }
        Ok(message)
    }
}

fn append(
    target: &mut String,
    value: Option<&Value>,
    maximum: usize,
) -> Result<(), ModelServiceError> {
    if let Some(value) = value.filter(|value| !value.is_null()) {
        let text = value.as_str().ok_or(ModelServiceError::Protocol)?;
        if target.len() + text.len() > maximum {
            log::warn!("[model-stream] rejected reason=field_size_limit limit={maximum}");
            return Err(ModelServiceError::ResponseTooLarge);
        }
        target.push_str(text);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(delta: Value, finish: Value) -> String {
        format!(
            "data: {}\r\n\r\n",
            json!({"choices":[{"index":0,"delta":delta,"finish_reason":finish}]})
        )
    }

    #[test]
    fn only_offered_public_tools_can_publish_their_arguments() {
        for (offered, name) in [
            (["propose_handoff", "search_help"], "complete_discussion"),
            (["propose_handoff", "search_help"], "propose_handoff"),
            (["complete_discussion", "search_help"], "propose_handoff"),
            (["complete_discussion", "search_help"], "search_help"),
        ] {
            let tools = offered.map(|name| json!({"type":"function","function":{"name":name}}));
            let body = json!({"tools":tools});
            let wire = format!(
                "{}{}data: [DONE]\n\n",
                frame(json!({"content":"Public"}), Value::Null),
                frame(
                    json!({"content":" context","reasoning_content":"private reasoning","tool_calls":[{"index":0,"id":"call","function":{"name":name,"arguments":r#"{"answer":"private argument","plan":"private argument"}"#}}]}),
                    json!("tool_calls")
                )
            );
            let mut decoder = Decoder::for_request(&body, true);
            let mut progress = Vec::new();
            decoder
                .push(wire.as_bytes(), &mut |text| progress.push(text.to_owned()))
                .unwrap();
            assert_eq!(progress, ["Public", "Public context"]);
            assert_eq!(decoder.message().unwrap()["content"], "Public context");
        }
    }

    #[test]
    fn public_tool_preview_requires_one_observed_call_and_a_complete_tool_name() {
        let body = json!({"tools":[{"type":"function","function":{"name":"complete_discussion"}}]});
        let first = frame(
            json!({"tool_calls":[{"index":0,"id":"answer","function":{"name":"complete_","arguments":r#"{"answer":"首"#}}]}),
            Value::Null,
        );
        let second = frame(
            json!({"tool_calls":[{"index":0,"function":{"name":"discussion","arguments":"段"}}]}),
            Value::Null,
        );
        let additional_call = frame(
            json!({"tool_calls":[{"index":1,"id":"read","function":{"name":"search_help","arguments":r#"{"query":"private"}"#}}]}),
            Value::Null,
        );
        for (wire, expected) in [
            (
                format!("{first}{second}{additional_call}"),
                vec!["首段", ""],
            ),
            (format!("{first}{additional_call}{second}"), vec![]),
        ] {
            let mut decoder = Decoder::for_request(&body, false);
            let mut progress = Vec::new();
            decoder
                .push(wire.as_bytes(), &mut |text| progress.push(text.to_owned()))
                .unwrap();
            assert_eq!(progress, expected);
        }
    }

    #[test]
    fn deepseek_reasoning_is_separate_bounded_and_never_published_as_progress() {
        for reasoning in ["".to_owned(), "思考".repeat(20000)] {
            let mut decoder = Decoder {
                retain_reasoning: true,
                ..Decoder::default()
            };
            let mut progress = Vec::new();
            let wire = format!(
                "{}{}data: [DONE]\n\n",
                frame(json!({"reasoning_content":reasoning}), Value::Null),
                frame(json!({"content":"Answer"}), json!("stop"))
            );
            for chunk in wire.as_bytes().chunks(1023) {
                decoder
                    .push(chunk, &mut |text| progress.push(text.to_owned()))
                    .unwrap();
            }
            assert_eq!(progress, ["Answer"]);
            let message = decoder.message().unwrap();
            assert_eq!(message["reasoning_content"], reasoning);
            assert_eq!(message["content"], "Answer");
        }
        for (reasoning, expected) in [
            (json!(42), ModelServiceError::Protocol),
            (
                json!("x".repeat(provider::MAX_REASONING_BYTES + 1)),
                ModelServiceError::ResponseTooLarge,
            ),
        ] {
            let mut decoder = Decoder {
                retain_reasoning: true,
                ..Decoder::default()
            };
            assert_eq!(
                decoder
                    .push(
                        frame(json!({"reasoning_content":reasoning}), Value::Null).as_bytes(),
                        &mut |_| {}
                    )
                    .err(),
                Some(expected)
            );
        }
    }

    #[test]
    fn structured_rejections_and_deepseek_finish_reasons_keep_actionable_categories() {
        for (code, expected) in [
            ("invalid_request_error", ModelServiceError::RequestRejected),
            ("unsupported_tools", ModelServiceError::ToolsUnsupported),
            (
                "insufficient_system_resource",
                ModelServiceError::ServiceUnavailable,
            ),
        ] {
            let mut decoder = Decoder::default();
            let frame = format!(
                "data: {}\n\n",
                json!({"error":{"type":code,"message":"private provider text"}})
            );
            assert_eq!(
                decoder.push(frame.as_bytes(), &mut |_| {}).err(),
                Some(expected)
            );
        }
        for (finish, expected) in [
            ("aborted", ModelServiceError::ResponseInterrupted),
            (
                "insufficient_system_resource",
                ModelServiceError::ServiceUnavailable,
            ),
        ] {
            let mut decoder = Decoder::default();
            assert_eq!(
                decoder
                    .push(
                        frame(json!({"content":"partial"}), json!(finish)).as_bytes(),
                        &mut |_| {}
                    )
                    .err(),
                Some(expected)
            );
        }
    }

    #[test]
    fn fragmented_utf8_and_interleaved_tool_arguments_are_assembled_without_reasoning() {
        let wire = format!(
            ": keepalive\r\n\r\n{}{}{}{}{}data: [DONE]\r\n\r\n",
            frame(
                json!({"role":"assistant","reasoning_content":"private reasoning"}),
                Value::Null
            ),
            frame(
                json!({"content":"查阅","tool_calls":[{"index":1,"id":"second","type":"function","function":{"name":"read_help_section","arguments":"{\"docId\":"}}]}),
                Value::Null
            ),
            frame(
                json!({"role":null,"content":"资料","tool_calls":[{"index":0,"id":"first","type":"function","function":{"name":"search_help","arguments":"{\"query\":\"monitor\"}"}},{"index":1,"function":{"arguments":"\"manifest\"}"}}]}),
                Value::Null
            ),
            frame(json!({}), json!("tool_calls")),
            "data: {\"choices\":[],\"usage\":{}}\r\n\r\n",
        );
        let mut decoder = Decoder::default();
        let mut progress = Vec::new();
        for byte in wire.as_bytes() {
            decoder
                .push(&[*byte], &mut |text| progress.push(text.to_owned()))
                .unwrap();
        }
        assert_eq!(progress, ["查阅", "查阅资料"]);
        let message = decoder.message().unwrap();
        assert_eq!(message["content"], "查阅资料");
        assert!(!message.to_string().contains("private reasoning"));
        assert_eq!(message["tool_calls"][0]["id"], "first");
        assert_eq!(
            message["tool_calls"][1]["function"]["arguments"],
            "{\"docId\":\"manifest\"}"
        );
    }

    #[test]
    fn malformed_or_incomplete_streams_never_become_successful_replies() {
        let samples = [
            "data: [DONE]\n\n".to_owned(),
            "data: not-json\n\n".to_owned(),
            "data: {\"error\":{\"message\":\"secret provider detail\"}}\n\n".to_owned(),
            "data: {\"choices\":[{\"index\":1,\"delta\":{}}]}\n\n".to_owned(),
            frame(json!({"role":"tool"}), Value::Null),
            frame(json!({"tool_calls":[{"index":8}]}), Value::Null),
            frame(
                json!({"tool_calls":[{"index":0,"type":"shell"}]}),
                Value::Null,
            ),
            frame(json!({"content":false}), Value::Null),
            format!(
                "{}{}data: [DONE]\n\n",
                frame(json!({"content":"partial"}), json!("stop")),
                frame(json!({"content":"late"}), Value::Null)
            ),
        ];
        for wire in samples {
            let mut decoder = Decoder::default();
            let outcome = decoder
                .push(wire.as_bytes(), &mut |_| {})
                .and_then(|()| decoder.message());
            assert_eq!(outcome.err(), Some(ModelServiceError::Protocol));
        }
    }

    #[test]
    fn an_error_in_the_same_network_chunk_keeps_preceding_accepted_text() {
        for (ending, error) in [
            ("data: not-json\n\n".to_owned(), ModelServiceError::Protocol),
            (
                frame(json!({}), json!("length")),
                ModelServiceError::OutputTruncated,
            ),
        ] {
            let wire = format!(
                "{}{ending}",
                frame(json!({"content":"accepted prefix"}), Value::Null)
            );
            let mut decoder = Decoder::default();
            let mut progress = Vec::new();
            assert_eq!(
                decoder
                    .push(wire.as_bytes(), &mut |text| progress.push(text.to_owned()))
                    .err(),
                Some(error)
            );
            assert_eq!(progress, ["accepted prefix"]);
        }
    }

    #[test]
    fn explicit_context_overflows_are_distinct_in_sse_errors_and_finish_reasons() {
        for wire in [
            "data: {\"error\":{\"code\":\"1261\",\"message\":\"private input\"}}\n\n".to_owned(),
            frame(json!({}), json!("model_context_window_exceeded")),
        ] {
            let mut decoder = Decoder::default();
            assert_eq!(
                decoder.push(wire.as_bytes(), &mut |_| {}).err(),
                Some(ModelServiceError::ContextWindowExceeded)
            );
        }
    }

    #[test]
    fn output_exhaustion_and_incomplete_streams_have_distinct_errors() {
        let mut decoder = Decoder::default();
        assert_eq!(
            decoder
                .push(frame(json!({}), json!("length")).as_bytes(), &mut |_| {})
                .err(),
            Some(ModelServiceError::OutputTruncated)
        );
        let mut decoder = Decoder::default();
        decoder
            .push(
                frame(json!({"content":"partial"}), json!("stop")).as_bytes(),
                &mut |_| {},
            )
            .unwrap();
        assert_eq!(
            decoder.message().err(),
            Some(ModelServiceError::ResponseInterrupted)
        );
    }

    #[test]
    fn a_large_code_proposal_can_exceed_the_old_eight_kib_argument_cap() {
        let arguments = json!({"text":"const score = 1;\n".repeat(2000)}).to_string();
        let wire = format!(
            "{}{}data: [DONE]\n\n",
            frame(
                json!({"tool_calls":[{"index":0,"id":"proposal","type":"function","function":{"name":"propose_text_change","arguments":arguments}}]}),
                Value::Null
            ),
            frame(json!({}), json!("tool_calls"))
        );
        let mut decoder = Decoder::default();
        decoder.push(wire.as_bytes(), &mut |_| {}).unwrap();
        assert_eq!(
            decoder.message().unwrap()["tool_calls"][0]["function"]["arguments"],
            arguments
        );
    }

    #[test]
    fn long_reasoning_and_wire_metadata_do_not_block_small_multi_file_candidates() {
        // GLM emits metadata on every token. None of this reasoning is retained;
        // the final two edit candidates are small and within semantic limits.
        let reasoning = format!(
            "data: {}\n\n",
            json!({
                "id":"fixture-".repeat(20), "model":"glm-compatible-fixture",
                "created":1792245000_u64,
                "choices":[{"index":0,"delta":{"reasoning_content":"private fragment"},"finish_reason":null}]
            })
        );
        let mut wire = reasoning.repeat(4000);
        let edits = json!({"path":"server.js","version":"v1","parameters":[],"edits":[{"oldText":"old","newText":"new"}]}).to_string();
        wire.push_str(&frame(json!({"tool_calls":[
            {"index":0,"id":"server","type":"function","function":{"name":"propose_text_change","arguments":edits}},
            {"index":1,"id":"manifest","type":"function","function":{"name":"propose_text_change","arguments":json!({"path":"manifest.json","version":"v2","parameters":[],"text":"{}"}).to_string()}}
        ]}), Value::Null));
        wire.push_str(&frame(json!({}), json!("tool_calls")));
        wire.push_str("data: [DONE]\n\n");
        assert!(wire.len() > 1024 * 1024);
        for chunk_size in [16 * 1024, wire.len()] {
            let mut decoder = Decoder::default();
            for chunk in wire.as_bytes().chunks(chunk_size) {
                decoder.push(chunk, &mut |_| {}).expect(
                    "valid fragmented stream must not be charged for cumulative wire overhead",
                );
            }
            let message = decoder.message().unwrap();
            assert!(!message.to_string().contains("private fragment"));
            assert_eq!(message["tool_calls"].as_array().unwrap().len(), 2);
            assert_eq!(
                message["tool_calls"][0]["function"]["name"],
                "propose_text_change"
            );
        }
    }

    #[test]
    fn unterminated_multiline_events_remain_bounded_across_network_chunks() {
        let line = format!("data: {}\n", "x".repeat(32768));
        let mut decoder = Decoder::default();
        let mut rejected = false;
        for _ in 0..40 {
            if let Err(error) = decoder.push(line.as_bytes(), &mut |_| {}) {
                assert_eq!(error, ModelServiceError::ResponseTooLarge);
                rejected = true;
                break;
            }
            assert!(decoder.pending.len() + decoder.data.len() <= MAX_EVENT_BYTES);
        }
        assert!(rejected);
    }

    #[test]
    fn incomplete_events_text_and_tool_argument_budgets_are_bounded() {
        for (wire, maximum) in [
            (vec![b'x'; MAX_EVENT_BYTES + 1], MAX_EVENT_BYTES),
            (
                frame(
                    json!({"content":"x".repeat(MAX_TEXT_BYTES + 1)}),
                    Value::Null,
                )
                .into_bytes(),
                MAX_TEXT_BYTES,
            ),
            (
                frame(
                    json!({"tool_calls":[{"index":0,"function":{"arguments":"x".repeat(256 * 1024 + 1)}}]}),
                    Value::Null,
                )
                .into_bytes(),
                256 * 1024,
            ),
        ] {
            assert!(wire.len() > maximum);
            let mut decoder = Decoder::default();
            assert_eq!(
                decoder.push(&wire, &mut |_| {}).err(),
                Some(ModelServiceError::ResponseTooLarge)
            );
        }
    }
}
