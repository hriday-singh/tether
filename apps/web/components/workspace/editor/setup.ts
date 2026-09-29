import { HighlightStyle, syntaxHighlighting, syntaxTree, type LanguageSupport } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { LanguageId } from '@/lib/languages';

/** Language support loaded on demand per language (docs/07: code-split per language). */
export function loadLanguage(id: LanguageId): Promise<LanguageSupport> {
  switch (id) {
    case 'javascript':
      return import('@codemirror/lang-javascript').then((m) => m.javascript());
    case 'typescript':
      return import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true }));
    case 'html':
      return import('@codemirror/lang-html').then((m) => m.html());
    case 'css':
      return import('@codemirror/lang-css').then((m) => m.css());
    case 'python':
      return import('@codemirror/lang-python').then((m) => m.python());
    case 'go':
      return import('@codemirror/lang-go').then((m) => m.go());
    case 'rust':
      return import('@codemirror/lang-rust').then((m) => m.rust());
    case 'c':
    case 'cpp':
      return import('@codemirror/lang-cpp').then((m) => m.cpp());
    case 'java':
      return import('@codemirror/lang-java').then((m) => m.java());
    case 'csharp':
      return Promise.all([
        import('@codemirror/legacy-modes/mode/clike'),
        import('@codemirror/language'),
      ]).then(([clike, lang]) => new lang.LanguageSupport(lang.StreamLanguage.define(clike.csharp)));
    case 'markdown':
      return import('@codemirror/lang-markdown').then((m) => m.markdown());
    case 'sql':
      return import('@codemirror/lang-sql').then((m) => m.sql());
  }
}

/** Editor chrome from tokens only: surface, gutter, active line, selection. */
export const quietTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--foreground)',
    fontSize: 'var(--editor-font-size, 13px)',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
    fontFeatureSettings: "'tnum', 'zero'",
    overscrollBehavior: 'contain',
  },
  '.cm-content': { caretColor: 'var(--primary)', padding: '12px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-line-number)',
    border: 'none',
    borderRight: '1px solid var(--editor-gutter-border)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px', cursor: 'pointer' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active-line)', color: 'var(--foreground)' },
  '.cm-selectionLayer': { zIndex: '0 !important' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--editor-selection) !important',
  },
  '.cm-matchingBracket': { backgroundColor: 'var(--accent)', outline: '1px solid var(--border)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent)' },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in oklch, var(--warning) 30%, transparent)',
    borderRadius: '2px',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in oklch, var(--warning) 60%, transparent) !important',
    outline: '1.5px solid var(--warning)',
    borderRadius: '2px',
  },
  '.cm-panels': {
    backgroundColor: 'var(--card)',
    color: 'var(--foreground)',
    borderBottom: '1px solid var(--border)',
  },
  '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': {
    padding: '8px 12px',
    backgroundColor: 'var(--card)',
    color: 'var(--card-foreground)',
    fontFamily: 'var(--font-sans)',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    position: 'relative',
  },
  '.cm-panel.cm-search [name=close]': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '24px',
    height: '24px',
    display: 'inline-grid',
    placeItems: 'center',
    borderRadius: '6px',
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.15s ease',
  },
  '.cm-panel.cm-search [name=close]:hover': {
    backgroundColor: 'var(--accent)',
    color: 'var(--foreground)',
  },
  '.cm-panel.cm-search input[type="text"], .cm-panel.cm-search .cm-textfield': {
    height: '28px',
    padding: '0 8px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: 'var(--text-caption, 12px)',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  },
  '.cm-panel.cm-search input[type="text"]:focus, .cm-panel.cm-search .cm-textfield:focus': {
    borderColor: 'var(--ring)',
    boxShadow: '0 0 0 1.5px var(--ring)',
  },
  '.cm-panel.cm-search button.cm-button': {
    height: '26px',
    padding: '0 10px',
    borderRadius: '6px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--secondary)',
    color: 'var(--secondary-foreground)',
    fontSize: 'var(--text-caption, 12px)',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    transition: 'background-color 0.15s ease, border-color 0.15s ease',
  },
  '.cm-panel.cm-search button.cm-button:hover': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: 'var(--text-caption, 12px)',
    color: 'var(--muted-foreground)',
    cursor: 'pointer',
    userSelect: 'none',
    marginRight: '8px',
  },
  '.cm-panel.cm-search input[type="checkbox"]': {
    accentColor: 'var(--primary)',
    cursor: 'pointer',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
  },
});

export const quietHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: 'var(--syntax-keyword)' },
    { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syntax-string)' },
    { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syntax-number)' },
    { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syntax-function)' },
    { tag: [t.typeName, t.className, t.namespace], color: 'var(--syntax-type)' },
    { tag: [t.tagName], color: 'var(--syntax-tag)' },
    { tag: [t.attributeName, t.propertyName], color: 'var(--syntax-attr)' },
    { tag: [t.heading], color: 'var(--syntax-function)', fontWeight: '600' },
    { tag: [t.link, t.url], color: 'var(--primary)', textDecoration: 'underline' },
    { tag: t.invalid, color: 'var(--destructive)' },
  ]),
);

const OPEN = new Set(['(', '[', '{']);
const BRACKETS = new Set(['(', ')', '[', ']', '{', '}']);
const bracketMarks = [1, 2, 3].map((n) => Decoration.mark({ class: `cm-bracket-${n}` }));

function bracketDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (!BRACKETS.has(node.name)) return;
        // Depth = number of enclosing bracketed nodes, counted from the syntax tree (visible range only).
        let depth = -1;
        for (let p = node.node.parent; p; p = p.parent) {
          const first = p.firstChild;
          if (first && OPEN.has(first.name)) depth += 1;
        }
        builder.add(node.from, node.to, bracketMarks[Math.max(0, depth) % 3]!);
      },
    });
  }
  return builder.finish();
}

/** Bracket pair colorization (Settings > Editor). Visible ranges only, so it stays cheap on big docs. */
export const bracketColors: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = bracketDecorations(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = bracketDecorations(u.view);
        }
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.baseTheme({
    '.cm-bracket-1': { color: 'var(--bracket-1)' },
    '.cm-bracket-2': { color: 'var(--bracket-2)' },
    '.cm-bracket-3': { color: 'var(--bracket-3)' },
  }),
];
