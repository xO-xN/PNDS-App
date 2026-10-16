//! Bounded Chat Completions SSE decoding. Only answer text is published;
//! fragmented tool arguments are validated after the complete turn arrives.
use super::{transport, ModelServiceError};
use serde_json::{json, Value};
use std::collections::BTreeMap;

const MAX_STREAM_BYTES: usize = 1024 * 1024;
const MAX_TEXT_BYTES: usize = 64 * 1024;

pub(super) async fn request(
    client: &reqwest::Client,
    endpoint: &str,
    key: &str,
    body: Value,
    mut on_text: impl FnMut(&str) + Send,
) -> Result<Value, ModelServiceError> {
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
        let message = transport::read_message(response).await?;
        if let Some(text) = message["content"].as_str().filter(|text| !text.is_empty()) {
            on_text(text);
        }
        return Ok(message);
    }
    let mut decoder = Decoder::default();
    while let Some(chunk) = response.chunk().await.map_err(transport::transport_error)? {
        decoder.push(&chunk, &mut on_text)?;
        if decoder.done {
            return decoder.message();
        }
    }
    // A closed body without the terminator is incomplete, even after some text.
    Err(ModelServiceError::Protocol)
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
    wire_bytes: usize,
    text: String,
    calls: BTreeMap<u64, Call>,
    finished: bool,
    done: bool,
    usage: Option<Value>,
}

impl Decoder {
    fn push(
        &mut self,
        bytes: &[u8],
        on_text: &mut impl FnMut(&str),
    ) -> Result<(), ModelServiceError> {
        self.wire_bytes += bytes.len();
        if self.wire_bytes > MAX_STREAM_BYTES {
            return Err(ModelServiceError::Protocol);
        }
        self.pending.extend_from_slice(bytes);
        while let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line = self.pending.drain(..=end).collect::<Vec<_>>();
            let line = std::str::from_utf8(&line).map_err(|_| ModelServiceError::Protocol)?;
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                if !self.data.is_empty() {
                    let data = std::mem::take(&mut self.data);
                    let previous_len = self.text.len();
                    self.event(data.trim_end_matches('\n'))?;
                    // A later malformed event can share this network chunk.
                    // Preserve each accepted prefix before parsing the next one.
                    if self.text.len() != previous_len {
                        on_text(&self.text);
                    }
                }
            } else if let Some(data) = line.strip_prefix("data:") {
                self.data.push_str(data.strip_prefix(' ').unwrap_or(data));
                self.data.push('\n');
            }
        }
        Ok(())
    }

    fn event(&mut self, data: &str) -> Result<(), ModelServiceError> {
        if data == "[DONE]" && self.finished && !self.done {
            self.done = true;
            return Ok(());
        }
        let value: Value = serde_json::from_str(data).map_err(|_| ModelServiceError::Protocol)?;
        if self.done || value.get("error").is_some() {
            return Err(ModelServiceError::Protocol);
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
                    append(&mut target.arguments, function.get("arguments"), 8192)?;
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
                return Err(ModelServiceError::Protocol);
            }
            self.finished = true;
        }
        Ok(())
    }

    fn message(self) -> Result<Value, ModelServiceError> {
        if !self.finished || !self.done {
            return Err(ModelServiceError::Protocol);
        }
        Ok(json!({
            "role": "assistant",
            "usage": self.usage,
            "content": self.text,
            "tool_calls": self.calls.into_values().map(|call| json!({
                "id":call.id, "type":"function", "function":{"name":call.name,"arguments":call.arguments}
            })).collect::<Vec<_>>()
        }))
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
            return Err(ModelServiceError::Protocol);
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
            frame(json!({"content":"partial"}), json!("length")),
            frame(json!({"content":"partial"}), json!("stop")),
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
        for ending in [
            "data: not-json\n\n".to_owned(),
            frame(json!({}), json!("length")),
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
                Some(ModelServiceError::Protocol)
            );
            assert_eq!(progress, ["accepted prefix"]);
        }
    }

    #[test]
    fn stream_wire_text_and_tool_argument_budgets_are_bounded() {
        for (wire, maximum) in [
            (vec![b'x'; MAX_STREAM_BYTES + 1], MAX_STREAM_BYTES),
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
                    json!({"tool_calls":[{"index":0,"function":{"arguments":"x".repeat(8193)}}]}),
                    Value::Null,
                )
                .into_bytes(),
                8192,
            ),
        ] {
            assert!(wire.len() > maximum);
            let mut decoder = Decoder::default();
            assert_eq!(
                decoder.push(&wire, &mut |_| {}).err(),
                Some(ModelServiceError::Protocol)
            );
        }
    }
}
