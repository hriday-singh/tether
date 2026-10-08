import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const WRAP = new Set(['*', '_', '`', '~']);
const PAIR = new Set(['*', '_']);
const isWord = (ch: string) => /\w/.test(ch);

/**
 * Markdown typing helpers (pure, tested):
 * - `*` `_` `` ` `` `~` with a selection wraps it and keeps it selected, so a second `*` makes it bold.
 * - A second `*`/`_` at a word start completes the pair: `**|**`. `foo__bar` and `* bullet` are left alone.
 * - Typing the closing `*`/`_` steps over the auto-inserted one instead of doubling it.
 */
export function markdownInput(state: EditorState, from: number, to: number, text: string): TransactionSpec | null {
  if (!WRAP.has(text) || state.selection.ranges.length > 1) return null;
  if (from !== to) {
    return {
      changes: [
        { from, insert: text },
        { from: to, insert: text },
      ],
      selection: EditorSelection.range(from + 1, to + 1),
      userEvent: 'input.type',
    };
  }
  if (!PAIR.has(text)) return null;
  const prev = state.sliceDoc(from - 1, from);
  const next = state.sliceDoc(from, from + 2);
  if (next[0] === text && (next === text + text || prev === text)) {
    return { selection: { anchor: from + 1 }, userEvent: 'select' };
  }
  const beforeRun = state.sliceDoc(from - 2, from - 1);
  if (prev === text && beforeRun !== text && !isWord(beforeRun)) {
    return { changes: { from, insert: text.repeat(3) }, selection: { anchor: from + 1 }, userEvent: 'input.type' };
  }
  return null;
}

export const markdownHelpers = EditorView.inputHandler.of((view, from, to, text) => {
  const spec = markdownInput(view.state, from, to, text);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
});
