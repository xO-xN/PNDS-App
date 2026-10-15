use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelUsage {
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub cached_input_tokens: Option<u32>,
    pub reasoning_tokens: Option<u32>,
}

pub(super) fn parse(value: &Value) -> Option<ModelUsage> {
    let number = |value: &Value| {
        value
            .as_u64()
            .filter(|count| *count <= 1_000_000_000)
            .map(|count| count as u32)
    };
    let input = number(&value["prompt_tokens"]);
    let output = number(&value["completion_tokens"]);
    if input.is_none() && output.is_none() {
        return None;
    }
    Some(ModelUsage {
        input_tokens: input,
        output_tokens: output,
        cached_input_tokens: number(&value["prompt_tokens_details"]["cached_tokens"])
            .filter(|cached| input.is_some_and(|input| *cached <= input)),
        reasoning_tokens: number(&value["completion_tokens_details"]["reasoning_tokens"])
            .filter(|reasoning| output.is_some_and(|output| *reasoning <= output)),
    })
}
