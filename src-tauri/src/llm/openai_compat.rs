//! `/chat/completions` streaming, as spoken by OpenAI, DeepSeek, OpenRouter, Ollama, LM Studio
//! and llama.cpp's server.

use std::collections::VecDeque;

use futures_util::{future::BoxFuture, stream, StreamExt};
use reqwest::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE},
    RequestBuilder, Response,
};
use serde::Serialize;
use serde_json::Value;
use tracing::debug;

use super::{
    client,
    error::{ErrorKind, LlmError},
    sse::SseDecoder,
    ChatDelta, ChatMessage, ChatRequest, DeltaStream, LlmProvider,
};

/// Enough of an error body for its message; a server could send far more.
const MAX_ERROR_BODY: usize = 64 * 1024;
/// A whole reply from a server that ignored `stream: true`.
const MAX_PLAIN_BODY: usize = 4 * 1024 * 1024;

pub struct OpenAiCompat {
    base_url: String,
    model: String,
    key: Option<String>,
}

impl OpenAiCompat {
    pub fn new(base_url: String, model: String, key: Option<String>) -> Self {
        Self {
            base_url,
            model,
            key,
        }
    }

    fn authorised(&self, request: RequestBuilder) -> Result<RequestBuilder, LlmError> {
        let Some(key) = &self.key else {
            return Ok(request);
        };
        let mut value = HeaderValue::from_str(&format!("Bearer {key}")).map_err(|_| {
            LlmError::new(
                ErrorKind::Auth,
                Some("the stored key has characters a request header cannot carry".into()),
            )
        })?;
        // Keeps the header out of any Debug output of the request.
        value.set_sensitive(true);
        Ok(request.header(AUTHORIZATION, value))
    }

    async fn send(&self, request: RequestBuilder) -> Result<Response, LlmError> {
        let response = self
            .authorised(request)?
            .send()
            .await
            .map_err(|error| LlmError::from_transport(&error))?;
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }
        let body = read_capped(response, MAX_ERROR_BODY)
            .await
            .unwrap_or_default();
        Err(LlmError::from_status(
            status.as_u16(),
            &String::from_utf8_lossy(&body),
            self.key.as_deref(),
        ))
    }
}

#[derive(Serialize)]
struct Body<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    stream: bool,
}

impl LlmProvider for OpenAiCompat {
    fn stream(&self, request: ChatRequest) -> BoxFuture<'_, Result<DeltaStream, LlmError>> {
        Box::pin(async move {
            let body = Body {
                model: &self.model,
                messages: &request.messages,
                stream: true,
            };
            let post = client()?
                .post(format!("{}/chat/completions", self.base_url))
                .json(&body);
            let response = self.send(post).await?;
            let streamed = response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .is_none_or(|value| value.starts_with("text/event-stream"));
            if streamed {
                Ok(deltas(response, self.key.clone()))
            } else {
                whole_reply(response).await
            }
        })
    }

    fn models(&self) -> BoxFuture<'_, Result<Vec<String>, LlmError>> {
        Box::pin(async move {
            let get = client()?.get(format!("{}/models", self.base_url));
            let response = self.send(get).await?;
            let body = read_capped(response, MAX_PLAIN_BODY).await?;
            Ok(model_ids(&body))
        })
    }
}

/// Reads a body up to `limit` bytes; the rest is dropped with the connection.
async fn read_capped(response: Response, limit: usize) -> Result<Vec<u8>, LlmError> {
    let mut body = Vec::new();
    let mut chunks = response.bytes_stream();
    while let Some(chunk) = chunks.next().await {
        let chunk = chunk.map_err(|error| LlmError::from_transport(&error))?;
        let room = limit.saturating_sub(body.len());
        body.extend_from_slice(&chunk[..chunk.len().min(room)]);
        if body.len() >= limit {
            break;
        }
    }
    Ok(body)
}

/// A server that answered with one JSON completion: replay it as a single delta.
async fn whole_reply(response: Response) -> Result<DeltaStream, LlmError> {
    let body = read_capped(response, MAX_PLAIN_BODY).await?;
    let text = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/choices/0/message/content")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .ok_or_else(|| {
            LlmError::new(
                ErrorKind::Stream,
                Some("the server answered with something other than a chat reply".into()),
            )
        })?;
    let deltas = (!text.is_empty()).then_some(Ok(ChatDelta::Text(text)));
    Ok(stream::iter(deltas).boxed())
}

struct StreamState {
    body: stream::BoxStream<'static, reqwest::Result<Vec<u8>>>,
    decoder: SseDecoder,
    ready: VecDeque<Result<ChatDelta, LlmError>>,
    done: bool,
    key: Option<String>,
}

impl StreamState {
    fn take_events(&mut self, events: impl IntoIterator<Item = super::sse::SseEvent>) {
        for event in events {
            if self.done {
                return;
            }
            if event.data.trim() == "[DONE]" {
                self.done = true;
                return;
            }
            match parse_chunk(&event.data, self.key.as_deref()) {
                Ok(deltas) => self.ready.extend(deltas.into_iter().map(Ok)),
                Err(error) => self.fail(error),
            }
        }
    }

    fn fail(&mut self, error: LlmError) {
        self.ready.push_back(Err(error));
        self.done = true;
    }
}

fn deltas(response: Response, key: Option<String>) -> DeltaStream {
    let state = StreamState {
        body: response
            .bytes_stream()
            .map(|chunk| chunk.map(Vec::from))
            .boxed(),
        decoder: SseDecoder::default(),
        ready: VecDeque::new(),
        done: false,
        key,
    };
    stream::unfold(state, |mut state| async move {
        loop {
            if let Some(item) = state.ready.pop_front() {
                return Some((item, state));
            }
            if state.done {
                return None;
            }
            match state.body.next().await {
                Some(Ok(chunk)) => match state.decoder.push(&chunk) {
                    Ok(events) => state.take_events(events),
                    Err(error) => {
                        state.fail(LlmError::new(ErrorKind::Stream, Some(error.to_string())))
                    }
                },
                Some(Err(error)) => state.fail(LlmError::from_transport(&error).mid_stream()),
                None => {
                    let last = state.decoder.finish();
                    state.take_events(last);
                    state.done = true;
                }
            }
        }
    })
    .boxed()
}

/// One `data:` payload. Chunks that do not parse are skipped: model output and servers are
/// untrusted, and one bad chunk should not end a reply.
fn parse_chunk(data: &str, key: Option<&str>) -> Result<Vec<ChatDelta>, LlmError> {
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        debug!("skipping a stream chunk that is not JSON");
        return Ok(Vec::new());
    };
    if let Some(error) = value.get("error") {
        return Err(LlmError::from_stream_error(error, key));
    }
    let Some(delta) = value.pointer("/choices/0/delta") else {
        return Ok(Vec::new());
    };
    let text = |field: &str| {
        delta
            .get(field)
            .and_then(Value::as_str)
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    let mut deltas = Vec::new();
    // DeepSeek and most local servers say `reasoning_content`; OpenRouter and Ollama `reasoning`.
    if let Some(reasoning) = text("reasoning_content").or_else(|| text("reasoning")) {
        deltas.push(ChatDelta::Reasoning(reasoning));
    }
    if let Some(content) = text("content") {
        deltas.push(ChatDelta::Text(content));
    }
    Ok(deltas)
}

fn model_ids(body: &[u8]) -> Vec<String> {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return Vec::new();
    };
    let mut ids: Vec<String> = value
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|model| model.get("id").and_then(Value::as_str))
        .filter(|id| !id.is_empty() && !id.chars().any(char::is_control))
        .map(str::to_owned)
        .collect();
    ids.sort();
    ids.dedup();
    ids
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_and_reasoning_are_told_apart() {
        let chunk = r#"{"choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"}}]}"#;
        assert_eq!(
            parse_chunk(chunk, None).expect("ok"),
            [ChatDelta::Text("Hi".into())]
        );

        let chunk = r#"{"choices":[{"delta":{"content":null,"reasoning_content":"Hmm"}}]}"#;
        assert_eq!(
            parse_chunk(chunk, None).expect("ok"),
            [ChatDelta::Reasoning("Hmm".into())]
        );

        let chunk = r#"{"choices":[{"delta":{"content":"","reasoning":"Let me see"}}]}"#;
        assert_eq!(
            parse_chunk(chunk, None).expect("ok"),
            [ChatDelta::Reasoning("Let me see".into())]
        );
    }

    #[test]
    fn chunks_without_deltas_are_ignored() {
        for chunk in [
            r#"{"choices":[],"usage":{"total_tokens":9}}"#,
            r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
            "not json",
            r#"{"id":"x"}"#,
        ] {
            assert!(parse_chunk(chunk, None).expect("ok").is_empty(), "{chunk}");
        }
    }

    #[test]
    fn an_error_chunk_ends_the_reply() {
        let chunk = r#"{"error":{"message":"Rate limit exceeded","code":429}}"#;
        let error = parse_chunk(chunk, None).expect_err("error");
        assert_eq!(error.kind, ErrorKind::RateLimited);
    }

    #[test]
    fn the_request_body_asks_for_a_stream() {
        let messages = [ChatMessage {
            role: super::super::Role::User,
            content: "Hello".into(),
        }];
        let body = Body {
            model: "m",
            messages: &messages,
            stream: true,
        };
        assert_eq!(
            serde_json::to_value(&body).expect("serialise"),
            serde_json::json!({
                "model": "m",
                "messages": [{ "role": "user", "content": "Hello" }],
                "stream": true,
            })
        );
    }

    #[test]
    fn model_lists_are_sorted_and_cleaned() {
        let body = br#"{"object":"list","data":[{"id":"b"},{"id":"a"},{"id":""},{"id":"a"},{"name":"x"}]}"#;
        assert_eq!(model_ids(body), ["a", "b"]);
        assert!(model_ids(b"<html>").is_empty());
    }
}
