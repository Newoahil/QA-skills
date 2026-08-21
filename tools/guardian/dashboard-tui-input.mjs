const ESC = '\u001b';
const COMPLETE_ESCAPE_SEQUENCES = Object.freeze({
  [`${ESC}[A`]: { type: 'up' },
  [`${ESC}[B`]: { type: 'down' },
  [`${ESC}[C`]: { type: 'focus-right' },
  [`${ESC}[D`]: { type: 'focus-left' },
  [`${ESC}[5~`]: { type: 'page-up' },
  [`${ESC}[6~`]: { type: 'page-down' },
  [`${ESC}[H`]: { type: 'home' },
  [`${ESC}[1~`]: { type: 'home' },
  [`${ESC}[F`]: { type: 'end' },
  [`${ESC}[4~`]: { type: 'end' },
});
const ESCAPE_PREFIXES = Object.freeze(new Set([
  ESC,
  `${ESC}[`,
  ...Object.keys(COMPLETE_ESCAPE_SEQUENCES),
].flatMap((sequence) => Array.from({ length: sequence.length }, (_, index) => sequence.slice(0, index + 1)))));

export const TUI_TABS = Object.freeze({
  summary: 'summary',
  transcript: 'transcript',
  logs: 'logs',
  artifacts: 'artifacts',
});

const TAB_KEYS = Object.freeze({
  '1': TUI_TABS.summary,
  '2': TUI_TABS.transcript,
  '3': TUI_TABS.logs,
  '4': TUI_TABS.artifacts,
});

export function parseKeypress(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  if (!text) return { type: 'noop' };
  if (text === 'q' || text === 'Q') return { type: 'quit' };
  if (text === '?') return { type: 'toggle-help' };
  if (text === 'r' || text === 'R') return { type: 'refresh' };
  if (text === 'a' || text === 'A') return { type: 'toggle-auto-refresh' };
  if (text === 'f' || text === 'F') return { type: 'toggle-transcript-full' };
  if (text === 'g' || text === 'G') return { type: 'logs-follow-end' };
  if (text === 'p' || text === 'P') return { type: 'logs-pause-follow' };
  if (text in TAB_KEYS) return { type: 'switch-tab', tab: TAB_KEYS[text] };
  if (text === '\r' || text === '\n') return { type: 'enter-detail' };
  if (text === '\t') return { type: 'cycle-focus' };
  if (text === ESC) return { type: 'back-queue' };
  if (text === 'j' || text === 'J') return { type: 'down' };
  if (text === 'k' || text === 'K') return { type: 'up' };
  if (text === 'h' || text === 'H') return { type: 'focus-left' };
  if (text === 'l' || text === 'L') return { type: 'focus-right' };
  if (COMPLETE_ESCAPE_SEQUENCES[text]) return COMPLETE_ESCAPE_SEQUENCES[text];
  if (text === '\u0003') return { type: 'quit' };
  return { type: 'noop', raw: text };
}

function isEscapePrefix(text) {
  return ESCAPE_PREFIXES.has(text);
}

export function createKeypressParser() {
  let pending = '';

  function consumePending() {
    const actions = [];
    while (pending) {
      if (pending.startsWith(ESC)) {
        const exactEscape = COMPLETE_ESCAPE_SEQUENCES[pending];
        if (exactEscape) {
          actions.push(exactEscape);
          pending = '';
          continue;
        }
        if (isEscapePrefix(pending)) break;
        if (pending.length >= 2 && !pending.startsWith(`${ESC}[`)) {
          actions.push({ type: 'back-queue' });
          pending = pending.slice(1);
          continue;
        }
        if (pending.startsWith(`${ESC}[`)) {
          const matched = Object.keys(COMPLETE_ESCAPE_SEQUENCES).find((sequence) => pending.startsWith(sequence));
          if (matched) {
            actions.push(COMPLETE_ESCAPE_SEQUENCES[matched]);
            pending = pending.slice(matched.length);
            continue;
          }
        }
        if (pending === ESC || isEscapePrefix(pending)) break;
        actions.push({ type: 'back-queue' });
        pending = pending.slice(1);
        continue;
      }

      const action = parseKeypress(pending[0]);
      actions.push(action);
      pending = pending.slice(1);
    }
    return actions;
  }

  return {
    feed(input) {
      const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
      if (!text) return [];
      pending += text;
      return consumePending();
    },
    flush() {
      if (!pending) return [];
      if (pending === ESC) {
        pending = '';
        return [{ type: 'back-queue' }];
      }
      const raw = pending;
      pending = '';
      return [{ type: 'noop', raw }];
    },
    hasPending() {
      return pending.length > 0;
    },
  };
}
