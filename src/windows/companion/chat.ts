// Connects the companion to the core's turn loop: sends the user's messages, feeds the
// reply's segments through the speech queue, and reports what was shown (D57).

import { readingTimePlayer } from "@/audio/readingTime";
import { createSpeechQueue, type SpeechQueue } from "@/audio/speechQueue";
import {
  chatStatus,
  onChatRequested,
  onProvidersChanged,
  onSpeechSegment,
  onTurnEnded,
  reportSegmentShown,
  sendChat,
} from "@/ipc";
import { errorMessage } from "@/shared/errorMessage";
import { useChatStore } from "@/stores/chat";

/** How long a reply's last subtitle stays after its reading time. */
const HOLD_MS = 1200;

let queue: SpeechQueue | null = null;
// The id of the turn this page last started; ids only grow.
let latestTurn = 0;
// For the input's Up key; kept here so it outlives the input closing.
let lastSent: string | null = null;

function warn(what: string) {
  return (error: unknown) => console.warn(`failed to ${what}`, error);
}

/** Follows the core's chat events until the returned function is called. */
export function startChat(): () => void {
  const speech = createSpeechQueue({
    play: readingTimePlayer,
    holdMs: HOLD_MS,
    onShow: (segment) => {
      if (segment === null) {
        useChatStore.setState({ subtitle: null });
        return;
      }
      useChatStore.setState({ subtitle: segment, waiting: false });
      reportSegmentShown(segment.turn, segment.index).catch(warn("report a shown segment"));
    },
  });
  queue = speech;

  let statusRequest = 0;
  const refreshStatus = () => {
    const current = ++statusRequest;
    chatStatus()
      .then((status) => {
        if (current === statusRequest) useChatStore.setState({ status });
      })
      .catch(warn("read the chat status"));
  };

  const subscriptions = [
    onSpeechSegment((segment) => speech.push(segment)),
    onTurnEnded(({ turn, error }) => {
      speech.end(turn);
      if (turn < latestTurn) return;
      useChatStore.setState({ waiting: false });
      if (error !== null) {
        useChatStore.setState({ notice: error });
        useChatStore.getState().openInput();
      }
    }),
    onChatRequested(() => useChatStore.getState().openInput()),
    onProvidersChanged(refreshStatus),
  ];
  refreshStatus();

  return () => {
    speech.dispose();
    queue = null;
    for (const subscription of subscriptions) {
      subscription.then((stop) => stop()).catch(warn("unsubscribe from chat events"));
    }
  };
}

/** Sends the user's message. Whatever the companion was saying stops at once. */
export async function sendMessage(text: string): Promise<void> {
  lastSent = text;
  queue?.expect(latestTurn + 1);
  useChatStore.setState({ waiting: true, notice: null });
  try {
    const turn = await sendChat(text);
    latestTurn = Math.max(latestTurn, turn);
    queue?.expect(turn);
  } catch (error) {
    useChatStore.setState({ waiting: false, notice: errorMessage(error) });
  }
}

/** The last message sent from this page, for the input to recall. */
export function lastSentMessage(): string | null {
  return lastSent;
}
