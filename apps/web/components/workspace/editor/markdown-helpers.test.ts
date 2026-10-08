import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { markdownInput } from './markdown-helpers';

/** Applies one typed char at the cursor/selection (`|` marks cursor, `[..]` a selection) and returns the doc with `|`. */
function type(src: string, ch: string): string {
  const sel = src.includes('[') ? EditorSelection.range(src.indexOf('['), src.indexOf(']') - 1) : EditorSelection.cursor(src.indexOf('|'));
  const state = EditorState.create({ doc: src.replace(/[|[\]]/g, ''), selection: sel });
  const spec = markdownInput(state, state.selection.main.from, state.selection.main.to, ch);
  const tr = spec ? state.update(spec) : state.update(state.replaceSelection(ch));
  const doc = tr.state.doc.toString();
  const { from, to } = tr.state.selection.main;
  return from === to ? doc.slice(0, from) + '|' + doc.slice(from) : `${doc.slice(0, from)}[${doc.slice(from, to)}]${doc.slice(to)}`;
}

describe('markdownInput', () => {
  it('wraps a selection and keeps it selected, so twice is bold', () => {
    expect(type('say [hi] now', '*')).toBe('say *[hi]* now');
    expect(type('say *[hi]* now', '*')).toBe('say **[hi]** now');
    expect(type('[x]', '`')).toBe('`[x]`');
  });

  it('pairs ** and __ at a word start, then steps over the closer', () => {
    expect(type('*|', '*')).toBe('**|**');
    expect(type('a _|', '_')).toBe('a __|__');
    expect(type('**bold|**', '*')).toBe('**bold*|*');
    expect(type('**bold*|*', '*')).toBe('**bold**|');
  });

  it('leaves bullets, snake_case and single markers alone', () => {
    expect(type('|', '*')).toBe('*|');
    expect(type('foo_|', '_')).toBe('foo__|');
    expect(type('word*|', '*')).toBe('word**|');
    expect(type('|', '`')).toBe('`|');
  });
});
