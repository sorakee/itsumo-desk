//! Why a provider call failed, sorted into the kinds the fallback chain (D56) acts on. The
//! provider's own message is kept as detail, trimmed and with the key redacted, since some
//! providers quote part of the key back.

use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// 401/403: the key is wrong, revoked or lacks access.
    Auth,
    /// 402, or a balance or quota error under another status.
    Credits,
    RateLimited,
    Server,
    /// Refused connection, unknown host, TLS failure.
    Unreachable,
    /// No answer, or no first token, in time.
    Timeout,
    ModelNotFound,
    /// A 404 that is not about the model: usually a base URL without `/v1`.
    EndpointNotFound,
    BadRequest,
    /// The reply broke off or could not be read.
    Stream,
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{}", self.describe())]
pub struct LlmError {
    pub kind: ErrorKind,
    detail: Option<String>,
}

/// Enough of a provider's message to act on, short enough for a settings row.
const MAX_DETAIL_CHARS: usize = 300;

impl LlmError {
    pub fn new(kind: ErrorKind, detail: Option<String>) -> Self {
        Self { kind, detail }
    }

    /// An HTTP error response. `key` is redacted from the provider's message.
    pub fn from_status(status: u16, body: &str, key: Option<&str>) -> Self {
        let message = serde_json::from_str::<Value>(body)
            .ok()
            .and_then(|value| message_of(&value))
            .unwrap_or_else(|| body.to_owned());
        let detail = clean_detail(&message, key);
        Self {
            kind: classify(status, detail.as_deref().unwrap_or_default()),
            detail,
        }
    }

    /// An `{"error": …}` object sent inside the stream instead of an HTTP status, as
    /// OpenRouter does once streaming has started.
    pub fn from_stream_error(error: &Value, key: Option<&str>) -> Self {
        let detail = message_of(&serde_json::json!({ "error": error }))
            .and_then(|message| clean_detail(&message, key));
        let status = error
            .get("code")
            .and_then(Value::as_u64)
            .and_then(|code| u16::try_from(code).ok());
        let text = detail.as_deref().unwrap_or_default();
        let kind = match status {
            Some(status) => classify(status, text),
            None if mentions_credits(text) => ErrorKind::Credits,
            None => ErrorKind::Stream,
        };
        Self { kind, detail }
    }

    /// A failure below HTTP: connecting, sending, or reading the body.
    pub fn from_transport(error: &reqwest::Error) -> Self {
        let kind = if error.is_timeout() {
            ErrorKind::Timeout
        } else if error.is_connect() {
            ErrorKind::Unreachable
        } else {
            ErrorKind::Stream
        };
        // The chain names the URL and the OS reason; URLs never carry credentials (the base
        // URL is validated) and the key travels only in a header.
        let mut chain = error.to_string();
        let mut source = std::error::Error::source(error);
        while let Some(cause) = source {
            chain.push_str(": ");
            chain.push_str(&cause.to_string());
            source = cause.source();
        }
        Self::new(kind, clean_detail(&chain, None))
    }

    /// The same failure after the reply started: anything but a stall is a broken stream.
    pub fn mid_stream(self) -> Self {
        let kind = match self.kind {
            ErrorKind::Timeout => ErrorKind::Timeout,
            _ => ErrorKind::Stream,
        };
        Self { kind, ..self }
    }

    fn describe(&self) -> String {
        let summary = match self.kind {
            ErrorKind::Auth => "The provider rejected the API key. Check that it is correct and still active.",
            ErrorKind::Credits => "The account has run out of credits or quota.",
            ErrorKind::RateLimited => "The provider is limiting requests right now. Try again in a moment.",
            ErrorKind::Server => "The provider had a server error. Try again later.",
            ErrorKind::Unreachable => "Could not reach the server. Check the base URL, and that a local server is running.",
            ErrorKind::Timeout => "The server did not answer in time.",
            ErrorKind::ModelNotFound => "The provider does not know this model. Check the model name.",
            ErrorKind::EndpointNotFound => "There is no chat endpoint at this base URL. It usually ends in /v1.",
            ErrorKind::BadRequest => "The provider rejected the request.",
            ErrorKind::Stream => "The reply broke off.",
        };
        match &self.detail {
            Some(detail) => format!("{summary} ({detail})"),
            None => summary.to_owned(),
        }
    }
}

fn message_of(value: &Value) -> Option<String> {
    let error = value.get("error").unwrap_or(value);
    let message = match error {
        Value::String(text) => Some(text.as_str()),
        Value::Object(fields) => ["message", "detail", "error"]
            .iter()
            .find_map(|field| fields.get(*field).and_then(Value::as_str)),
        _ => None,
    };
    message.map(str::to_owned)
}

fn classify(status: u16, detail: &str) -> ErrorKind {
    let text = detail.to_lowercase();
    if matches!(status, 400 | 402 | 403 | 429) && mentions_credits(&text) {
        return ErrorKind::Credits;
    }
    let about_model = (text.contains("model")
        && [
            "not found",
            "not exist",
            "no such",
            "not a valid",
            "unknown",
        ]
        .iter()
        .any(|phrase| text.contains(phrase)))
        || text.contains("model_not_found");
    match status {
        401 | 403 => ErrorKind::Auth,
        402 => ErrorKind::Credits,
        404 if text.contains("model") => ErrorKind::ModelNotFound,
        404 => ErrorKind::EndpointNotFound,
        408 => ErrorKind::Timeout,
        429 => ErrorKind::RateLimited,
        500..=599 => ErrorKind::Server,
        _ if about_model => ErrorKind::ModelNotFound,
        _ => ErrorKind::BadRequest,
    }
}

fn mentions_credits(text: &str) -> bool {
    let text = text.to_lowercase();
    [
        "insufficient balance",
        "insufficient_quota",
        "insufficient credits",
        "exceeded your current quota",
        "more credits",
        "billing",
        "payment required",
    ]
    .iter()
    .any(|phrase| text.contains(phrase))
}

/// Collapses whitespace, redacts the key and anything shaped like one, and trims to length.
fn clean_detail(message: &str, key: Option<&str>) -> Option<String> {
    let mut text = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if let Some(key) = key.filter(|key| !key.is_empty()) {
        text = text.replace(key, "[key]");
    }
    let text = text
        .split(' ')
        .map(|word| if looks_like_key(word) { "[key]" } else { word })
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        return None;
    }
    if text.chars().count() <= MAX_DETAIL_CHARS {
        return Some(text);
    }
    let cut: String = text.chars().take(MAX_DETAIL_CHARS).collect();
    Some(format!("{cut}…"))
}

/// `sk-…`-style tokens: a known prefix and a long run of key characters.
fn looks_like_key(word: &str) -> bool {
    let word = word.trim_matches(|c: char| !c.is_ascii_alphanumeric());
    let prefixed = ["sk-", "sk_", "key-"]
        .iter()
        .any(|prefix| word.starts_with(prefix));
    prefixed
        && word.len() >= 20
        && word
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kind(status: u16, body: &str) -> ErrorKind {
        LlmError::from_status(status, body, None).kind
    }

    #[test]
    fn statuses_map_to_kinds() {
        assert_eq!(
            kind(401, r#"{"error":{"message":"Invalid key"}}"#),
            ErrorKind::Auth
        );
        assert_eq!(kind(403, "forbidden"), ErrorKind::Auth);
        assert_eq!(kind(402, ""), ErrorKind::Credits);
        assert_eq!(kind(429, "slow down"), ErrorKind::RateLimited);
        assert_eq!(kind(503, "<html>bad gateway</html>"), ErrorKind::Server);
        assert_eq!(kind(408, ""), ErrorKind::Timeout);
        assert_eq!(kind(422, "nope"), ErrorKind::BadRequest);
    }

    #[test]
    fn credit_errors_are_found_under_other_statuses() {
        // DeepSeek, OpenAI and OpenRouter phrasings.
        assert_eq!(
            kind(400, r#"{"error":{"message":"Insufficient Balance"}}"#),
            ErrorKind::Credits
        );
        assert_eq!(
            kind(
                429,
                r#"{"error":{"message":"You exceeded your current quota","code":"insufficient_quota"}}"#
            ),
            ErrorKind::Credits
        );
        assert_eq!(
            kind(
                403,
                r#"{"error":{"message":"This request requires more credits"}}"#
            ),
            ErrorKind::Credits
        );
    }

    #[test]
    fn missing_models_and_wrong_urls_are_told_apart() {
        // Ollama, DeepSeek, OpenRouter.
        assert_eq!(
            kind(
                404,
                r#"{"error":{"message":"model \"qwen3:8b\" not found, try pulling it first"}}"#
            ),
            ErrorKind::ModelNotFound
        );
        assert_eq!(
            kind(400, r#"{"error":{"message":"Model Not Exist"}}"#),
            ErrorKind::ModelNotFound
        );
        assert_eq!(
            kind(
                400,
                r#"{"error":{"message":"foo is not a valid model ID"}}"#
            ),
            ErrorKind::ModelNotFound
        );
        assert_eq!(kind(404, "404 page not found"), ErrorKind::EndpointNotFound);
    }

    #[test]
    fn the_key_never_reaches_the_message() {
        let key = "sk-live-0123456789abcdefghij";
        let body = format!(r#"{{"error":{{"message":"Incorrect API key provided: {key}."}}}}"#);
        let error = LlmError::from_status(401, &body, Some(key));
        assert!(!error.to_string().contains(key));
        assert!(error.to_string().contains("[key]"));

        // A masked echo of some other key is redacted by shape.
        let error = LlmError::from_status(401, "bad key sk-proj-abc***************xyz9", None);
        assert!(!error.to_string().contains("sk-proj"));
    }

    #[test]
    fn details_are_collapsed_and_trimmed() {
        let error = LlmError::from_status(500, &format!("  a\n\n  b {}", "x".repeat(400)), None);
        let detail = error.detail.expect("detail");
        assert!(detail.starts_with("a b x"));
        assert_eq!(detail.chars().count(), MAX_DETAIL_CHARS + 1);
        assert_eq!(LlmError::from_status(500, "   ", None).detail, None);
    }

    #[test]
    fn stream_errors_use_their_code_when_numeric() {
        let error = serde_json::json!({ "message": "Rate limit exceeded", "code": 429 });
        assert_eq!(
            LlmError::from_stream_error(&error, None).kind,
            ErrorKind::RateLimited
        );
        let error = serde_json::json!({ "message": "Insufficient balance" });
        assert_eq!(
            LlmError::from_stream_error(&error, None).kind,
            ErrorKind::Credits
        );
        let error = serde_json::json!("upstream went away");
        assert_eq!(
            LlmError::from_stream_error(&error, None).kind,
            ErrorKind::Stream
        );
    }
}
