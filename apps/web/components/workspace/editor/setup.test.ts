import { openSearchPanel, search } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { quietTheme } from './setup';

describe('Editor Search / Find panel', () => {
  it('mounts the search panel with proper action buttons and accessibility attributes', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'hello world\nhello tether\n',
        extensions: [quietTheme, search({ top: true })],
      }),
    });

    openSearchPanel(view);

    const searchPanel = parent.querySelector('.cm-panel.cm-search');
    expect(searchPanel).not.toBeNull();

    // Verify search and replace fields
    const searchField = searchPanel?.querySelector('input[name="search"]') as HTMLInputElement | null;
    const replaceField = searchPanel?.querySelector('input[name="replace"]') as HTMLInputElement | null;
    expect(searchField).not.toBeNull();
    expect(replaceField).not.toBeNull();

    // Verify primary Next action button
    const nextBtn = searchPanel?.querySelector('button[name="next"]') as HTMLButtonElement | null;
    expect(nextBtn).not.toBeNull();
    expect(nextBtn?.getAttribute('type')).toBe('button');

    // Verify secondary navigation and action buttons
    const prevBtn = searchPanel?.querySelector('button[name="prev"]') as HTMLButtonElement | null;
    const selectBtn = searchPanel?.querySelector('button[name="select"]') as HTMLButtonElement | null;
    const replaceBtn = searchPanel?.querySelector('button[name="replace"]') as HTMLButtonElement | null;
    const replaceAllBtn = searchPanel?.querySelector('button[name="replaceAll"]') as HTMLButtonElement | null;

    expect(prevBtn).not.toBeNull();
    expect(selectBtn).not.toBeNull();
    expect(replaceBtn).not.toBeNull();
    expect(replaceAllBtn).not.toBeNull();

    // Verify close button
    const closeBtn = searchPanel?.querySelector('button[name="close"]') as HTMLButtonElement | null;
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.getAttribute('aria-label')).toBe('close');

    // Verify option toggle checkboxes
    const caseCheckbox = searchPanel?.querySelector('input[name="case"]') as HTMLInputElement | null;
    const reCheckbox = searchPanel?.querySelector('input[name="re"]') as HTMLInputElement | null;
    const wordCheckbox = searchPanel?.querySelector('input[name="word"]') as HTMLInputElement | null;

    expect(caseCheckbox).not.toBeNull();
    expect(reCheckbox).not.toBeNull();
    expect(wordCheckbox).not.toBeNull();
    expect(caseCheckbox?.type).toBe('checkbox');

    // Verify checkbox toggling
    expect(caseCheckbox?.checked).toBe(false);
    caseCheckbox?.click();
    expect(caseCheckbox?.checked).toBe(true);

    view.destroy();
    parent.remove();
  });
});
