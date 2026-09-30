import { HighlightStyle, syntaxHighlighting, syntaxTree, type LanguageSupport } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { LanguageId } from '@/lib/languages';
import { createLinterSource } from './linter';

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
    case 'json':
      return import('@codemirror/lang-json').then((m) => m.json());
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
  '.cm-content': { caretColor: 'var(--primary)', padding: '0.85em 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--primary)', borderLeftWidth: '2px' },
  '.cm-gutters': {
    backgroundColor: 'var(--editor-bg)',
    color: 'var(--editor-line-number)',
    border: 'none',
    borderRight: '1px solid var(--editor-gutter-border)',
  },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 0.45em 0 0.9em', cursor: 'pointer' },
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
    zIndex: '10 !important',
  },
  '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel.cm-search': {
    padding: '8px 40px 8px 12px',
    backgroundColor: 'var(--card)',
    color: 'var(--card-foreground)',
    fontFamily: 'var(--font-sans)',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    position: 'relative',
    zIndex: '10',
    boxShadow: 'var(--shadow-card)',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label': {
    margin: '0 !important',
  },
  '.cm-panel.cm-search br': {
    width: '100%',
    height: '0',
    margin: '2px 0 !important',
    border: 'none',
    flexBasis: '100%',
  },
  '.cm-panel.cm-search [name=close]': {
    position: 'absolute',
    top: '8px',
    right: '8px',
    width: '28px',
    height: '28px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 'var(--radius-lg, 8px)',
    backgroundColor: 'transparent',
    color: 'var(--muted-foreground)',
    fontSize: '16px',
    lineHeight: '1',
    cursor: 'pointer',
    border: 'none',
    outline: 'none',
    userSelect: 'none',
    transition: 'color var(--duration-fast, 120ms) var(--ease-standard), background-color var(--duration-fast, 120ms) var(--ease-standard), transform var(--duration-fast, 120ms) var(--ease-standard)',
  },
  '.cm-panel.cm-search [name=close]:hover': {
    backgroundColor: 'var(--accent)',
    color: 'var(--foreground)',
  },
  '.cm-panel.cm-search [name=close]:active': {
    transform: 'scale(0.95)',
  },
  '.cm-panel.cm-search [name=close]:focus-visible': {
    outline: '2px solid var(--ring)',
    outlineOffset: '2px',
  },
  '.cm-panel.cm-search input[type="text"], .cm-panel.cm-search .cm-textfield': {
    height: '28px',
    padding: '0 10px',
    borderRadius: 'var(--radius-lg, 8px)',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    fontSize: 'var(--text-caption, 12.5px)',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    transition: 'border-color var(--duration-fast, 120ms) var(--ease-standard), box-shadow var(--duration-fast, 120ms) var(--ease-standard)',
  },
  '.cm-panel.cm-search input[type="text"]:focus, .cm-panel.cm-search .cm-textfield:focus': {
    borderColor: 'var(--ring)',
    boxShadow: '0 0 0 2px color-mix(in oklch, var(--ring) 25%, transparent)',
  },
  '.cm-panel.cm-search input[type="text"]::placeholder, .cm-panel.cm-search .cm-textfield::placeholder': {
    color: 'var(--muted-foreground)',
  },
  '.cm-panel.cm-search button.cm-button': {
    height: '28px',
    padding: '0 10px',
    borderRadius: 'var(--radius-lg, 8px)',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--secondary)',
    backgroundImage: 'none',
    color: 'var(--foreground)',
    fontSize: 'var(--text-caption, 12.5px)',
    fontFamily: 'var(--font-sans)',
    fontWeight: '500',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '4px',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    textTransform: 'capitalize',
    outline: 'none',
    transition: 'color var(--duration-fast, 120ms) var(--ease-standard), background-color var(--duration-fast, 120ms) var(--ease-standard), border-color var(--duration-fast, 120ms) var(--ease-standard), transform var(--duration-fast, 120ms) var(--ease-standard), box-shadow var(--duration-fast, 120ms) var(--ease-standard)',
  },
  '.cm-panel.cm-search button.cm-button:hover': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-foreground)',
    borderColor: 'var(--border)',
  },
  '.cm-panel.cm-search button.cm-button:active': {
    transform: 'scale(0.98)',
  },
  '.cm-panel.cm-search button.cm-button:focus-visible': {
    outline: '2px solid var(--ring)',
    outlineOffset: '2px',
  },
  '.cm-panel.cm-search button.cm-button:disabled': {
    opacity: '0.5',
    pointerEvents: 'none',
    cursor: 'not-allowed',
  },
  '.cm-panel.cm-search button.cm-button[name="next"]': {
    fontWeight: '600',
  },
  /* Inline option labels */
  '.cm-panel.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 4px',
    height: '28px',
    color: 'var(--muted-foreground)',
    fontSize: 'var(--text-caption, 12.5px)',
    fontFamily: 'var(--font-sans)',
    cursor: 'pointer',
    userSelect: 'none',
    textTransform: 'capitalize',
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    transition: 'color var(--duration-fast, 120ms) var(--ease-standard)',
  },
  '.cm-panel.cm-search label:hover': {
    color: 'var(--foreground)',
  },
  '.cm-panel.cm-search label:has(input:checked)': {
    color: 'var(--foreground)',
    fontWeight: '500',
  },
  /* Animated circular checkbox */
  '.cm-panel.cm-search input[type="checkbox"]': {
    appearance: 'none !important',
    WebkitAppearance: 'none !important',
    width: '16px',
    height: '16px',
    minWidth: '16px',
    minHeight: '16px',
    borderRadius: '9999px',
    border: '1.5px solid color-mix(in oklch, var(--foreground) 45%, transparent)',
    backgroundColor: 'var(--background)',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    backgroundSize: '0 0',
    cursor: 'pointer',
    display: 'inline-grid',
    placeItems: 'center',
    margin: '0',
    verticalAlign: 'middle',
    outline: 'none',
    position: 'relative',
    transition: 'border-color var(--duration-fast, 150ms) var(--ease-standard), background-color var(--duration-fast, 150ms) var(--ease-standard), background-size var(--duration-fast, 150ms) var(--ease-standard), box-shadow var(--duration-fast, 150ms) var(--ease-standard), transform var(--duration-fast, 150ms) var(--ease-standard)',
  },
  '.cm-panel.cm-search input[type="checkbox"]:hover': {
    borderColor: 'var(--primary)',
    transform: 'scale(1.08)',
    boxShadow: '0 0 0 3px color-mix(in oklch, var(--primary) 15%, transparent)',
  },
  '.cm-panel.cm-search input[type="checkbox"]:active': {
    transform: 'scale(0.92)',
  },
  '.cm-panel.cm-search input[type="checkbox"]:focus-visible': {
    outline: '2px solid var(--ring)',
    outlineOffset: '2px',
  },
  '.cm-panel.cm-search input[type="checkbox"]:checked': {
    backgroundColor: 'var(--primary)',
    borderColor: 'var(--primary)',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'%3E%3C/polyline%3E%3C/svg%3E")`,
    backgroundSize: '10px 10px',
    boxShadow: '0 0 0 2px color-mix(in oklch, var(--primary) 25%, transparent)',
    transform: 'scale(1)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
  },
  '.cm-tooltip-lint': {
    padding: '0',
    backgroundColor: 'var(--popover)',
    color: 'var(--popover-foreground)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    boxShadow: 'var(--shadow-card)',
    overflow: 'hidden',
  },
  '.cm-diagnostic': {
    padding: '6px 10px',
    fontSize: 'var(--text-caption, 12px)',
    fontFamily: 'var(--font-sans)',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '6px',
    borderLeft: '3px solid transparent',
  },
  '.cm-diagnostic-error': {
    borderLeftColor: 'var(--destructive)',
    backgroundColor: 'color-mix(in oklch, var(--destructive) 6%, transparent)',
    color: 'var(--foreground)',
  },
  '.cm-diagnostic-warning': {
    borderLeftColor: 'var(--warning)',
    backgroundColor: 'color-mix(in oklch, var(--warning) 6%, transparent)',
    color: 'var(--foreground)',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--destructive)',
    textUnderlineOffset: '3px',
  },
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--warning)',
    textUnderlineOffset: '3px',
  },
  '.cm-lint-marker': {
    width: '0.62em',
    height: '0.62em',
    borderRadius: '9999px',
    display: 'block',
    margin: 'auto',
  },
  '.cm-lint-marker-error': {
    content: '""',
    backgroundColor: 'var(--destructive)',
    boxShadow: '0 0 0 0.18em color-mix(in oklch, var(--destructive) 25%, transparent)',
  },
  '.cm-lint-marker-warning': {
    content: '""',
    backgroundColor: 'var(--warning)',
    boxShadow: '0 0 0 0.18em color-mix(in oklch, var(--warning) 25%, transparent)',
  },
  '.cm-gutter-lint': {
    width: '1.4em',
    border: 'none',
  },
  '.cm-gutter-lint .cm-gutterElement': {
    padding: '0 !important',
    display: 'flex !important',
    alignItems: 'center !important',
    justifyContent: 'center !important',
  },
});

/** Dynamic theme extension configuring code font size so CodeMirror internal line layout measures accurately. */
export function editorFontSizeTheme(sizePx: number): Extension {
  return EditorView.theme({
    '&': {
      fontSize: `${sizePx}px`,
    },
  });
}

/** Returns CodeMirror lint extension with debounced Lezer/specialized diagnostics for this language. */
export function createLinterExtension(langId: LanguageId): Extension {
  return [
    linter(createLinterSource(langId), { delay: 250 }),
    lintGutter(),
  ];
}

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
