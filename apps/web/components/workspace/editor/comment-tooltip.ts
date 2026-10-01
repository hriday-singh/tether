import { StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, showTooltip, type Tooltip } from '@codemirror/view';

export const COMMENT_SHORTCUT = 'Mod-Shift-m';

/**
 * "Comment" chip above a non-empty selection plus Mod-Shift-M: both quote the selection into chat.
 * Uses CodeMirror's own tooltip layer, so it follows scroll and stays inside the editor.
 */
export function commentOnSelection(onComment: () => void): Extension {
  const tooltipFor = (state: EditorState): readonly Tooltip[] => {
    const sel = state.selection.main;
    if (sel.empty) return [];
    return [
      {
        pos: sel.from,
        above: true,
        strictSide: false,
        arrow: false,
        create: () => {
          const dom = document.createElement('button');
          dom.type = 'button';
          dom.className = 'cm-comment-chip';
          dom.textContent = 'Comment';
          dom.title = 'Quote in chat (Ctrl/Cmd+Shift+M)';
          // Keep the editor selection: the click must not move focus first.
          dom.addEventListener('mousedown', (e) => e.preventDefault());
          dom.addEventListener('click', onComment);
          return { dom };
        },
      },
    ];
  };

  const field = StateField.define<readonly Tooltip[]>({
    create: tooltipFor,
    update: (tooltips, tr) => (tr.selection || tr.docChanged ? tooltipFor(tr.state) : tooltips),
    provide: (f) => showTooltip.computeN([f], (state) => state.field(f)),
  });

  return [
    field,
    keymap.of([{ key: COMMENT_SHORTCUT, preventDefault: true, run: () => (onComment(), true) }]),
    EditorView.baseTheme({
      '.cm-tooltip:has(> .cm-comment-chip)': { border: 'none', background: 'transparent' },
      '.cm-comment-chip': {
        font: '500 var(--text-caption)/1.4 var(--font-sans)',
        padding: '2px 8px',
        borderRadius: 'var(--radius-md)',
        background: 'var(--primary)',
        color: 'var(--primary-foreground)',
        boxShadow: 'var(--shadow-capsule)',
        cursor: 'pointer',
        transition: 'opacity var(--duration-base, 150ms) var(--ease-standard)',
      },
      '.cm-comment-chip:hover': { opacity: '0.9' },
      '.cm-comment-chip:focus-visible': { outline: '2px solid var(--ring)', outlineOffset: '2px' },
    }),
  ];
}
