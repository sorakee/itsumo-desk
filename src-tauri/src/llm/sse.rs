//! Server-sent events as LLM providers stream them. Chunks may split anywhere, including
//! inside a line, a UTF-8 sequence or a CRLF pair, and some servers end without the final
//! blank line.

/// One dispatched event. OpenAI-compatible servers only use `data`; `event` names Anthropic's
/// event types.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SseEvent {
    pub event: Option<String>,
    pub data: String,
}

#[derive(Debug, thiserror::Error)]
#[error("a stream line was longer than {MAX_LINE} bytes")]
pub struct LineTooLong;

/// A line this long is not an LLM delta; stop rather than buffer without bound.
const MAX_LINE: usize = 1 << 20;

#[derive(Debug, Default)]
pub struct SseDecoder {
    line: Vec<u8>,
    data: Option<String>,
    event: Option<String>,
    /// The previous chunk ended in CR, so a leading LF finishes that line ending.
    after_cr: bool,
}

impl SseDecoder {
    /// Feeds the next chunk and returns the events it completed.
    pub fn push(&mut self, chunk: &[u8]) -> Result<Vec<SseEvent>, LineTooLong> {
        let mut events = Vec::new();
        for &byte in chunk {
            if std::mem::take(&mut self.after_cr) && byte == b'\n' {
                continue;
            }
            match byte {
                b'\n' => self.end_line(&mut events),
                b'\r' => {
                    self.end_line(&mut events);
                    self.after_cr = true;
                }
                _ if self.line.len() >= MAX_LINE => return Err(LineTooLong),
                _ => self.line.push(byte),
            }
        }
        Ok(events)
    }

    /// Ends the stream, dispatching an event the server left without its blank line.
    pub fn finish(&mut self) -> Option<SseEvent> {
        let mut events = Vec::new();
        if !self.line.is_empty() {
            self.end_line(&mut events);
        }
        self.end_line(&mut events);
        events.pop()
    }

    fn end_line(&mut self, events: &mut Vec<SseEvent>) {
        let line = std::mem::take(&mut self.line);
        if line.is_empty() {
            if let Some(data) = self.data.take() {
                events.push(SseEvent {
                    event: self.event.take(),
                    data,
                });
            }
            self.event = None;
            return;
        }
        let line = String::from_utf8_lossy(&line);
        if line.starts_with(':') {
            return;
        }
        let (field, value) = match line.split_once(':') {
            Some((field, value)) => (field, value.strip_prefix(' ').unwrap_or(value)),
            None => (line.as_ref(), ""),
        };
        match field {
            "data" => match &mut self.data {
                Some(data) => {
                    data.push('\n');
                    data.push_str(value);
                }
                None => self.data = Some(value.to_owned()),
            },
            "event" => self.event = Some(value.to_owned()),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn data(text: &str) -> SseEvent {
        SseEvent {
            event: None,
            data: text.into(),
        }
    }

    fn decode_in_pieces(stream: &[u8], size: usize) -> Vec<SseEvent> {
        let mut decoder = SseDecoder::default();
        let mut events = Vec::new();
        for chunk in stream.chunks(size) {
            events.extend(decoder.push(chunk).expect("push"));
        }
        events.extend(decoder.finish());
        events
    }

    #[test]
    fn events_survive_any_chunk_boundary() {
        let stream = "data: {\"a\":\"こんにちは\"}\r\n\r\n: keep-alive\n\ndata: [DONE]\r\n\r\n";
        for size in 1..stream.len() {
            assert_eq!(
                decode_in_pieces(stream.as_bytes(), size),
                [data("{\"a\":\"こんにちは\"}"), data("[DONE]")],
                "chunk size {size}"
            );
        }
    }

    #[test]
    fn data_lines_join_and_fields_parse() {
        let stream = b"event: message_start\ndata: one\ndata:two\ndata\nid: 7\nretry: 5\n\n";
        assert_eq!(
            decode_in_pieces(stream, 64),
            [SseEvent {
                event: Some("message_start".into()),
                data: "one\ntwo\n".into(),
            }]
        );
    }

    #[test]
    fn bare_cr_ends_lines() {
        assert_eq!(
            decode_in_pieces(b"data: a\r\rdata: b\r\r", 3),
            [data("a"), data("b")]
        );
    }

    #[test]
    fn a_missing_final_blank_line_still_dispatches() {
        assert_eq!(decode_in_pieces(b"data: [DONE]", 4), [data("[DONE]")]);
        assert_eq!(decode_in_pieces(b"data: x\n", 4), [data("x")]);
        assert!(decode_in_pieces(b": only a comment", 4).is_empty());
    }

    #[test]
    fn an_endless_line_is_an_error() {
        let mut decoder = SseDecoder::default();
        let chunk = vec![b'x'; MAX_LINE];
        assert!(decoder.push(&chunk).is_ok());
        assert!(decoder.push(b"x").is_err());
    }
}
