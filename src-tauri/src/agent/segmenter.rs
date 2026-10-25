//! Splits a streamed reply into segments, one per sentence or short utterance, as each one
//! completes: the unit the companion shows as a subtitle (and, from M3, speaks).
//!
//! The reply is untrusted text. Anything that does not look like a sentence end just keeps
//! the segment growing until it is long enough to break at a comma or a space.

/// Pieces narrower than this are joined to the next sentence, so "Oh!" does not flash by
/// on its own. Widths count a CJK character as two.
const MIN_WIDTH: usize = 16;
/// Wider than this, a sentence is broken at a comma or a space so the bubble stays small.
const MAX_WIDTH: usize = 160;

const OPEN_THINK: &str = "<think>";
const CLOSE_THINK: &str = "</think>";

/// Abbreviations whose full stop does not end a sentence (lower case, without the stop).
const ABBREVIATIONS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "st", "vs", "etc", "e.g", "i.e", "jr", "sr", "prof", "approx",
];

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
enum Think {
    /// Not yet known whether the reply opens with a `<think>` block.
    #[default]
    Undecided,
    /// Inside a `<think>` block, which some servers (LM Studio) put in the reply itself.
    Inside,
    Done,
}

#[derive(Debug, Default)]
pub struct Segmenter {
    /// Reply text not yet emitted, after any `<think>` block.
    text: String,
    /// Text that may still turn out to be part of a `<think>` block.
    pending: String,
    think: Think,
}

impl Segmenter {
    /// Adds a piece of the reply and returns the segments it completed. Each segment is the
    /// raw slice of the reply, including the whitespace before it; it is never blank.
    pub fn push(&mut self, delta: &str) -> Vec<String> {
        self.pending.push_str(delta);
        self.skip_think();
        if self.think == Think::Done {
            self.text.push_str(&self.pending);
            self.pending.clear();
        }
        let mut segments = Vec::new();
        while let Some(end) = boundary(&self.text, false) {
            segments.push(self.take(end));
        }
        segments
    }

    /// Ends the reply: returns the segments left over, the last one possibly unfinished.
    pub fn finish(&mut self) -> Vec<String> {
        if self.think == Think::Undecided {
            // Too short to be a `<think>` opening after all.
            self.text.push_str(&self.pending);
        }
        self.pending.clear();
        let mut segments = Vec::new();
        while let Some(end) = boundary(&self.text, true) {
            segments.push(self.take(end));
        }
        if !self.text.trim().is_empty() {
            segments.push(std::mem::take(&mut self.text));
        }
        self.text.clear();
        segments
    }

    fn take(&mut self, end: usize) -> String {
        let rest = self.text.split_off(end);
        std::mem::replace(&mut self.text, rest)
    }

    /// Drops a `<think>…</think>` block at the very start of the reply.
    fn skip_think(&mut self) {
        if self.think == Think::Undecided {
            let start = self.pending.trim_start();
            if let Some(inside) = start.strip_prefix(OPEN_THINK) {
                self.pending = inside.to_owned();
                self.think = Think::Inside;
            } else if !start.is_empty() && !OPEN_THINK.starts_with(start) {
                self.think = Think::Done;
            }
        }
        if self.think == Think::Inside {
            if let Some(at) = self.pending.find(CLOSE_THINK) {
                self.pending = self.pending[at + CLOSE_THINK.len()..].to_owned();
                self.think = Think::Done;
            } else {
                // Keep only what could be the start of the closing tag.
                let keep = self.pending.len().saturating_sub(CLOSE_THINK.len() - 1);
                let keep = (keep..=self.pending.len())
                    .find(|&at| self.pending.is_char_boundary(at))
                    .unwrap_or(self.pending.len());
                self.pending.drain(..keep);
            }
        }
    }
}

/// Where the first segment in `text` ends, if it is complete. `last` means no more text is
/// coming, so a full stop at the very end counts.
fn boundary(text: &str, last: bool) -> Option<usize> {
    let mut width = 0;
    // Where a long sentence may break, with the width up to there: after a comma (preferred
    // unless it leaves a short piece), or before a space.
    let mut comma_break: Option<(usize, usize)> = None;
    let mut space_break = None;
    let mut chars = text.char_indices().peekable();
    while let Some((at, c)) = chars.next() {
        let after = at + c.len_utf8();
        if !c.is_whitespace() || width > 0 {
            width += char_width(c);
        }
        if c == '\n' {
            if width > 0 {
                return Some(after);
            }
            continue;
        }
        let end = match c {
            '。' | '！' | '？' | '!' | '?' | '…' => Some(after_closers(text, after)),
            '.' if !is_abbreviation(&text[..at]) => Some(after_closers(text, after)),
            _ => None,
        };
        if let Some(end) = end {
            // ASCII stops end a sentence only before a space (not "3.5" or "a.m.").
            let ascii = c.is_ascii();
            let next = text[end..].chars().next();
            let complete = match next {
                None => last,
                Some(next) => !ascii || next.is_whitespace(),
            };
            if complete && width >= MIN_WIDTH {
                return Some(end);
            }
            if next.is_none() && !last {
                // Undecided until the next character arrives.
                return None;
            }
        }
        if matches!(c, ',' | '、' | '，' | ';' | '；') {
            comma_break = Some((after, width));
        } else if c.is_whitespace() && width > 0 {
            space_break = Some(at);
        }
        if width > MAX_WIDTH {
            let comma = comma_break
                .filter(|&(_, at_width)| at_width >= MAX_WIDTH / 2)
                .map(|(at, _)| at);
            return Some(comma.or(space_break).unwrap_or(at));
        }
        if chars.peek().is_none() {
            break;
        }
    }
    None
}

/// Past any closing quotes or brackets that follow a sentence's stop.
fn after_closers(text: &str, from: usize) -> usize {
    let rest = &text[from..];
    let skipped: usize = rest
        .chars()
        .take_while(|c| {
            matches!(
                c,
                '"' | '\''
                    | ')'
                    | ']'
                    | '」'
                    | '』'
                    | '）'
                    | '”'
                    | '’'
                    | '!'
                    | '?'
                    | '！'
                    | '？'
                    | '.'
                    | '…'
            )
        })
        .map(char::len_utf8)
        .sum();
    from + skipped
}

fn is_abbreviation(before: &str) -> bool {
    let word = before
        .rsplit(|c: char| c.is_whitespace())
        .next()
        .unwrap_or_default()
        .trim_start_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    // Initials such as "J." in "J. R. R. Tolkien".
    let initial = word.chars().count() == 1 && word.chars().all(char::is_alphabetic);
    initial || ABBREVIATIONS.contains(&word.as_str())
}

/// Two for characters that take a full em in CJK text, one otherwise.
fn char_width(c: char) -> usize {
    match u32::from(c) {
        0x1100..=0x115F
        | 0x2E80..=0x303E
        | 0x3041..=0x33FF
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xA000..=0xA4CF
        | 0xAC00..=0xD7A3
        | 0xF900..=0xFAFF
        | 0xFE30..=0xFE4F
        | 0xFF00..=0xFF60
        | 0xFFE0..=0xFFE6
        | 0x20000..=0x3FFFD => 2,
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds `reply` in pieces of `step` characters and returns the trimmed segments.
    fn split(reply: &str, step: usize) -> Vec<String> {
        let mut segmenter = Segmenter::default();
        let chars: Vec<char> = reply.chars().collect();
        let mut segments = Vec::new();
        for piece in chars.chunks(step) {
            segments.extend(segmenter.push(&piece.iter().collect::<String>()));
        }
        segments.extend(segmenter.finish());
        segments.iter().map(|s| s.trim().to_owned()).collect()
    }

    fn split_all_ways(reply: &str) -> Vec<String> {
        let whole = split(reply, usize::MAX);
        for step in [1, 2, 3, 7] {
            assert_eq!(split(reply, step), whole, "step {step}");
        }
        whole
    }

    #[test]
    fn splits_sentences_as_they_complete() {
        let mut segmenter = Segmenter::default();
        assert!(segmenter.push("Good morning, sleepyhead").is_empty());
        let done = segmenter.push("! Did you sleep well? I was up");
        assert_eq!(done, ["Good morning, sleepyhead!", " Did you sleep well?"]);
        assert_eq!(segmenter.finish(), [" I was up"]);
    }

    #[test]
    fn waits_for_the_character_after_a_stop() {
        let mut segmenter = Segmenter::default();
        assert!(segmenter.push("It costs about 3.").is_empty());
        assert!(segmenter.push("5 dollars here.").is_empty());
        assert_eq!(
            segmenter.push(" Cheap!"),
            ["It costs about 3.5 dollars here."]
        );
        assert_eq!(segmenter.finish(), [" Cheap!"]);
    }

    #[test]
    fn short_pieces_join_the_next_sentence() {
        assert_eq!(
            split_all_ways("Oh! Hi. You're back already? Nice."),
            ["Oh! Hi. You're back already?", "Nice."]
        );
    }

    #[test]
    fn keeps_abbreviations_initials_and_closing_quotes() {
        assert_eq!(
            split_all_ways(
                "Dr. Smith wrote \"The Long Night.\" J. R. R. Tolkien liked it, e.g. the end."
            ),
            [
                "Dr. Smith wrote \"The Long Night.\"",
                "J. R. R. Tolkien liked it, e.g. the end."
            ]
        );
    }

    #[test]
    fn splits_japanese_without_spaces() {
        assert_eq!(
            split_all_ways("おはよう！よく眠れた？私のほうが早起きだったけどね。"),
            ["おはよう！よく眠れた？", "私のほうが早起きだったけどね。"]
        );
        assert_eq!(
            split_all_ways("「行こう！」と言った。"),
            ["「行こう！」と言った。"]
        );
    }

    #[test]
    fn lines_are_segments_and_blank_lines_vanish() {
        assert_eq!(
            split_all_ways("First line without a stop\n\n\nSecond one\n"),
            ["First line without a stop", "Second one"]
        );
    }

    #[test]
    fn long_sentences_break_at_commas_or_spaces() {
        let long = format!(
            "{}, and then it went on{}",
            "word ".repeat(20).trim(),
            " more".repeat(30)
        );
        let segments = split_all_ways(&long);
        assert!(segments.len() > 1, "{segments:?}");
        assert!(segments[0].ends_with(','), "{segments:?}");
        for segment in &segments {
            assert!(segment.chars().count() <= MAX_WIDTH + 1, "{segment}");
        }
        assert_eq!(segments.join(" "), long);
        let unbroken = "x".repeat(MAX_WIDTH * 2);
        assert_eq!(split_all_ways(&unbroken).concat(), unbroken);
    }

    #[test]
    fn drops_a_leading_think_block() {
        assert_eq!(
            split_all_ways(
                "  <think>The user greets me. Answer warmly.</think>\n\nHello there, friend!"
            ),
            ["Hello there, friend!"]
        );
        assert_eq!(
            split_all_ways("<think>only thinking</think>"),
            Vec::<String>::new()
        );
        assert_eq!(split_all_ways("<think>cut off"), Vec::<String>::new());
        // Only at the start; elsewhere it is just text.
        assert_eq!(split_all_ways("I <think> so."), ["I <think> so."]);
        assert_eq!(split_all_ways("<thi"), ["<thi"]);
    }

    #[test]
    fn blank_replies_have_no_segments() {
        assert_eq!(split_all_ways(""), Vec::<String>::new());
        assert_eq!(split_all_ways(" \n \n"), Vec::<String>::new());
    }

    #[test]
    fn segments_concatenate_back_to_the_reply() {
        let reply = "Well... I suppose so. Fine, fine! Let's go now, okay?\nSee you.";
        let mut segmenter = Segmenter::default();
        let mut raw = segmenter.push(reply);
        raw.extend(segmenter.finish());
        assert_eq!(raw.concat(), reply);
    }
}
