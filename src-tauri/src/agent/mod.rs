//! The turn loop (`03-agent.md`): a user message goes to the chat provider and the reply
//! comes back to the companion as segments. Slice 2 keeps the history in memory and sends a
//! fixed system prompt; the prompt builder and output protocol (slice 3) and persistence
//! (slice 6) build on this.

mod segmenter;

use std::sync::{Mutex, MutexGuard, PoisonError};

use futures_util::StreamExt;
use serde::Serialize;
use specta::Type;
use tauri::{async_runtime::JoinHandle, AppHandle, Manager};
use tauri_specta::Event;
use tracing::{debug, warn};

use crate::{
    events::{SpeechSegment, TurnEnded},
    llm::{
        self, ChatDelta, ChatMessage, ChatProvider, ChatRequest, ErrorKind, LlmError,
        ProviderError, Role,
    },
    settings::SettingsStore,
};
use segmenter::Segmenter;

/// Stands in until the prompt builder (slice 3) brings the persona and output protocol.
const SYSTEM_PROMPT: &str = "You are a desktop companion character chatting with the user. \
    Reply in plain text without markdown, in one to three short sentences.";

/// Mirrored by `MAX_MESSAGE_CHARS` in `ChatInput.tsx`.
const MAX_MESSAGE_CHARS: usize = 2000;
/// Stops reading a model that will not end its reply; slice 3 adds a real token cap.
const MAX_REPLY_CHARS: usize = 4000;
/// Messages sent with each turn, oldest dropped first, until the rolling summary (slice 6).
const MAX_HISTORY: usize = 20;

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("{0}")]
    Invalid(&'static str),
    #[error(transparent)]
    Provider(#[from] ProviderError),
}

/// Whether chat can be used, so the chat input can say so before anything is typed.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatStatus {
    Ready {
        /// The profile chat uses, by name.
        provider: String,
    },
    /// `message` says what to set up in Settings.
    NotReady { message: String },
}

#[derive(Default)]
pub struct Agent(Mutex<State>);

#[derive(Default)]
struct State {
    last_turn: u32,
    /// The character the history was held with; another one starts afresh.
    character: Option<String>,
    history: Vec<ChatMessage>,
    /// The latest turn, until the next one starts: its reply may still be on screen.
    current: Option<Turn>,
}

struct Turn {
    id: u32,
    task: Option<JoinHandle<()>>,
    /// The reply so far as raw slices, so joining them restores the spacing between them.
    segments: Vec<String>,
    /// How many segments the companion has shown.
    shown: usize,
}

pub fn status(app: &AppHandle) -> ChatStatus {
    match llm::chat_profile(app) {
        Ok(profile) => ChatStatus::Ready {
            provider: profile.name,
        },
        Err(ProviderError::NoChatProvider) => ChatStatus::NotReady {
            message: ProviderError::NoChatProvider.to_string(),
        },
        Err(error) => ChatStatus::NotReady {
            message: format!("The chat provider is not ready. {error}"),
        },
    }
}

/// Starts a turn for the user's message and returns its id, interrupting any turn still in
/// flight. The reply arrives as `SpeechSegment` events, then a `TurnEnded`.
pub async fn send(app: &AppHandle, text: &str) -> Result<u32, AgentError> {
    let text = message(text)?;
    let chat = llm::chat_provider(app).await?;
    let character = app.state::<SettingsStore>().get().active_character;
    let agent = app.state::<Agent>();
    let (id, messages) = agent.begin(character, text);
    debug!(turn = id, messages = messages.len(), "chat turn started");
    let task = tauri::async_runtime::spawn(run(app.clone(), id, chat, messages));
    agent.attach(id, task);
    Ok(id)
}

/// The companion showed segment `index` of turn `turn`. What was shown is what an
/// interrupted reply keeps (D57).
pub fn segment_shown(app: &AppHandle, turn: u32, index: u32) {
    app.state::<Agent>().shown(turn, index);
}

fn message(text: &str) -> Result<String, AgentError> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AgentError::Invalid("The message is empty."));
    }
    if text.chars().count() > MAX_MESSAGE_CHARS {
        return Err(AgentError::Invalid("The message is too long."));
    }
    Ok(text
        .chars()
        .filter(|&c| !c.is_control() || matches!(c, '\n' | '\t'))
        .collect())
}

impl Agent {
    fn state(&self) -> MutexGuard<'_, State> {
        // The state stays consistent between statements, so a panic elsewhere cannot leave
        // it half-written.
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Records the user's message as a new turn and returns its id and the prompt.
    fn begin(&self, character: Option<String>, text: String) -> (u32, Vec<ChatMessage>) {
        let mut state = self.state();
        state.interrupt();
        if state.character != character {
            state.history.clear();
            state.character = character;
        }
        state.push(Role::User, text);
        state.last_turn = state.last_turn.wrapping_add(1);
        let id = state.last_turn;
        state.current = Some(Turn {
            id,
            task: None,
            segments: Vec::new(),
            shown: 0,
        });
        let mut messages = vec![ChatMessage {
            role: Role::System,
            content: SYSTEM_PROMPT.to_owned(),
        }];
        messages.extend(state.history.iter().cloned());
        (id, messages)
    }

    /// Keeps the turn's task so a newer message can stop it.
    fn attach(&self, id: u32, task: JoinHandle<()>) {
        match self.state().current.as_mut() {
            Some(turn) if turn.id == id => turn.task = Some(task),
            // Another message started a turn in the meantime.
            _ => task.abort(),
        }
    }

    /// Adds a segment to the turn's reply and returns its index, or `None` if the turn was
    /// interrupted.
    fn record(&self, id: u32, raw: String) -> Option<u32> {
        let mut state = self.state();
        let turn = state.current.as_mut().filter(|turn| turn.id == id)?;
        turn.segments.push(raw);
        u32::try_from(turn.segments.len() - 1).ok()
    }

    fn shown(&self, id: u32, index: u32) {
        let mut state = self.state();
        if let Some(turn) = state.current.as_mut().filter(|turn| turn.id == id) {
            let count = usize::try_from(index)
                .unwrap_or(usize::MAX)
                .saturating_add(1)
                .min(turn.segments.len());
            turn.shown = turn.shown.max(count);
        }
    }

    fn is_current(&self, id: u32) -> bool {
        self.state()
            .current
            .as_ref()
            .is_some_and(|turn| turn.id == id)
    }
}

impl State {
    /// Ends the latest turn, stopping its task if it is still streaming, and keeps as much
    /// of its reply as was shown.
    fn interrupt(&mut self) {
        let Some(turn) = self.current.take() else {
            return;
        };
        if let Some(task) = turn.task {
            task.abort();
        }
        let reply = turn.segments[..turn.shown].concat();
        let reply = reply.trim();
        if !reply.is_empty() {
            self.push(Role::Assistant, reply.to_owned());
        }
    }

    fn push(&mut self, role: Role, content: String) {
        // A reply interrupted before anything was shown leaves two user messages in a row;
        // they are joined, since some chat templates require the roles to alternate.
        if let Some(last) = self.history.last_mut().filter(|last| last.role == role) {
            last.content.push('\n');
            last.content.push_str(&content);
            return;
        }
        self.history.push(ChatMessage { role, content });
        if self.history.len() > MAX_HISTORY {
            let excess = self.history.len() - MAX_HISTORY;
            self.history.drain(..excess);
        }
        // Some APIs require the conversation to open with the user.
        while self
            .history
            .first()
            .is_some_and(|first| first.role == Role::Assistant)
        {
            self.history.remove(0);
        }
    }
}

async fn run(app: AppHandle, id: u32, chat: ChatProvider, messages: Vec<ChatMessage>) {
    let result = reply(&app, id, &chat, messages).await;
    if !app.state::<Agent>().is_current(id) {
        return;
    }
    let error = result.err().map(|error| {
        debug!(turn = id, %error, "chat turn failed");
        format!("{}: {error}", chat.name)
    });
    if let Err(error) = (TurnEnded { turn: id, error }).emit(&app) {
        warn!(%error, "failed to announce the end of a chat turn");
    }
}

/// Streams the reply, sending each segment as it completes.
async fn reply(
    app: &AppHandle,
    id: u32,
    chat: &ChatProvider,
    messages: Vec<ChatMessage>,
) -> Result<(), LlmError> {
    let request = ChatRequest { messages };
    let (mut stream, mut next) = tokio::time::timeout(chat.first_token_timeout, async {
        let mut stream = chat.provider.stream(request).await?;
        let first = stream.next().await;
        Ok::<_, LlmError>((stream, first))
    })
    .await
    .map_err(|_| LlmError::new(ErrorKind::Timeout, None))??;

    let mut segmenter = Segmenter::default();
    let mut length = 0;
    let result = loop {
        match next {
            None => break Ok(()),
            Some(Err(error)) => break Err(error),
            Some(Ok(ChatDelta::Reasoning(_))) => {}
            Some(Ok(ChatDelta::Text(text))) => {
                length += text.chars().count();
                for raw in segmenter.push(&text) {
                    publish(app, id, raw);
                }
                if length >= MAX_REPLY_CHARS {
                    debug!(turn = id, "chat reply cut off at the length limit");
                    break Ok(());
                }
            }
        }
        next = stream.next().await;
    };
    // What arrived before a failure is still shown; the error follows it.
    for raw in segmenter.finish() {
        publish(app, id, raw);
    }
    result
}

fn publish(app: &AppHandle, id: u32, raw: String) {
    let text = raw.trim().to_owned();
    let Some(index) = app.state::<Agent>().record(id, raw) else {
        return;
    };
    if let Err(error) = (SpeechSegment {
        turn: id,
        index,
        text,
    })
    .emit(app)
    {
        warn!(%error, "failed to send a speech segment");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turn(state: &mut State, character: &str, text: &str) -> u32 {
        let agent = Agent(Mutex::new(std::mem::take(state)));
        let (id, _) = agent.begin(Some(character.to_owned()), text.to_owned());
        *state = agent.0.into_inner().expect("not poisoned");
        id
    }

    fn reply(state: &mut State, segments: &[&str], shown: usize) {
        let current = state.current.as_mut().expect("a turn");
        current.segments = segments.iter().map(|s| (*s).to_owned()).collect();
        current.shown = shown;
    }

    fn history(state: &State) -> Vec<(Role, &str)> {
        state
            .history
            .iter()
            .map(|m| (m.role, m.content.as_str()))
            .collect()
    }

    #[test]
    fn an_interrupted_reply_keeps_what_was_shown() {
        let mut state = State::default();
        let first = turn(&mut state, "mao", "Hi!");
        reply(
            &mut state,
            &["Hello there, friend!", " How was your day?", " I"],
            2,
        );
        let second = turn(&mut state, "mao", "Fine.");
        assert!(second > first);
        assert_eq!(
            history(&state),
            [
                (Role::User, "Hi!"),
                (Role::Assistant, "Hello there, friend! How was your day?"),
                (Role::User, "Fine.")
            ]
        );
    }

    #[test]
    fn a_reply_nothing_of_was_shown_joins_the_user_messages() {
        let mut state = State::default();
        turn(&mut state, "mao", "Hi!");
        reply(&mut state, &["Hello there, friend!"], 0);
        turn(&mut state, "mao", "Are you there?");
        assert_eq!(history(&state), [(Role::User, "Hi!\nAre you there?")]);
    }

    #[test]
    fn another_character_starts_a_new_history() {
        let mut state = State::default();
        turn(&mut state, "mao", "Hi!");
        reply(&mut state, &["Hello!"], 1);
        turn(&mut state, "hiyori", "Who are you?");
        assert_eq!(history(&state), [(Role::User, "Who are you?")]);
    }

    #[test]
    fn history_is_capped_and_opens_with_the_user() {
        let mut state = State::default();
        for n in 0..MAX_HISTORY {
            turn(&mut state, "mao", &format!("message {n}"));
            reply(&mut state, &["Reply."], 1);
        }
        turn(&mut state, "mao", "last");
        assert!(state.history.len() <= MAX_HISTORY);
        assert_eq!(state.history[0].role, Role::User);
        assert_eq!(
            state.history.last().map(|m| m.content.as_str()),
            Some("last")
        );
    }

    #[test]
    fn shown_counts_only_segments_that_exist() {
        let agent = Agent::default();
        let (id, _) = agent.begin(None, "Hi".into());
        assert_eq!(agent.record(id, "One sentence here.".into()), Some(0));
        agent.shown(id, 5);
        agent.shown(id + 1, 0);
        assert_eq!(agent.state().current.as_ref().map(|t| t.shown), Some(1));
        assert_eq!(agent.record(id + 1, "stale".into()), None);
    }

    #[test]
    fn messages_are_trimmed_and_checked() {
        assert_eq!(
            message("  hello\u{7}\nthere  ").expect("ok"),
            "hello\nthere"
        );
        assert!(message("   ").is_err());
        assert!(message(&"a".repeat(MAX_MESSAGE_CHARS + 1)).is_err());
    }
}
