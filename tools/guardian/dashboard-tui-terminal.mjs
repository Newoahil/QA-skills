export function createTerminalSession({ stdin, stdout }) {
  let entered = false;
  let rawModeEnabled = false;

  function enter() {
    if (entered) return;
    entered = true;
    stdout.write('\u001b[?1049h\u001b[?25l\u001b[2J\u001b[H');
    if (typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(true);
      rawModeEnabled = true;
    }
    if (typeof stdin.resume === 'function') stdin.resume();
  }

  function render(frame) {
    stdout.write(`\u001b[H${frame}`);
  }

  function restore() {
    if (!entered) return;
    entered = false;
    if (rawModeEnabled && typeof stdin.setRawMode === 'function') {
      stdin.setRawMode(false);
      rawModeEnabled = false;
    }
    if (typeof stdin.pause === 'function') stdin.pause();
    stdout.write('\u001b[?25h\u001b[?1049l');
  }

  return {
    enter,
    render,
    restore,
    viewport() {
      return {
        columns: Number(stdout.columns) || 80,
        rows: Number(stdout.rows) || 24,
      };
    },
  };
}
