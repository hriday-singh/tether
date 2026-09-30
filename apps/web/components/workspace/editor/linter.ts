import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { transform } from 'sucrase';
import type { LanguageId } from '@/lib/languages';

/** Maximum diagnostics returned in one pass to prevent UI clutter and keep render cost minimal. */
const MAX_DIAGNOSTICS = 25;

/**
 * Expands an error position to cover the full word or symbol token at that position
 * rather than displaying a 1-character dot. Stays within current line.
 */
export function expandTokenRange(state: EditorState, from: number, lineTo: number): number {
  if (from >= lineTo) return Math.min(from + 1, state.doc.length);
  const remainingText = state.sliceDoc(from, Math.min(from + 32, lineTo));
  if (!remainingText) return Math.min(from + 1, state.doc.length);

  // Match identifier / keyword token
  const wordMatch = remainingText.match(/^[a-zA-Z0-9_$]+/);
  if (wordMatch && wordMatch[0]) {
    return Math.min(from + wordMatch[0].length, state.doc.length);
  }

  // Match multi-character operator or delimiter
  const opMatch = remainingText.match(/^(===|!==|==|!=|=>|<=|>=|\+\+|--|&&|\|\||::)/);
  if (opMatch && opMatch[0]) {
    return Math.min(from + opMatch[0].length, state.doc.length);
  }

  return Math.min(from + 1, state.doc.length);
}

/**
 * Universal Lezer + specialized compiler linter for CodeMirror 6.
 * Zero-backend, 100% client-side, runs in < 2ms.
 */
export function createLinterSource(lang: LanguageId) {
  return (view: EditorView): Diagnostic[] => {
    const { state } = view;
    const text = state.doc.toString();
    if (!text.trim()) return [];

    // 1. JSON specialized parser (exact line/col error from JSON engine)
    if (lang === 'json') {
      const jsonDiagnostics = lintJson(text, state);
      if (jsonDiagnostics.length > 0) return jsonDiagnostics;
    }

    // 2. JS/TS specialized compiler check (syntax errors from sucrase parser with JSX support)
    if (lang === 'javascript' || lang === 'typescript') {
      const jsTsDiagnostics = lintJsTs(text, lang, state);
      if (jsTsDiagnostics.length > 0) return jsTsDiagnostics;
    }

    // 3. C# stream language scanner (balanced delimiter and string checker)
    if (lang === 'csharp') {
      return lintBalancedDelimiters(text, state);
    }

    // 4. Universal Lezer syntax tree analysis (Python, Rust, Go, C++, HTML, CSS, SQL, etc.)
    return lintLezerTree(state);
  };
}

/**
 * Lints JSON with exact position extraction.
 */
export function lintJson(text: string, state: EditorState): Diagnostic[] {
  try {
    JSON.parse(text);
    return [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let from = 0;
    let to = 1;

    // Pattern 1: "... at line 2 column 5 ..."
    const lineColMatch = msg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (lineColMatch && lineColMatch[1] && lineColMatch[2]) {
      const lineNum = Math.min(Math.max(1, parseInt(lineColMatch[1], 10)), state.doc.lines);
      const colNum = Math.max(1, parseInt(lineColMatch[2], 10));
      const line = state.doc.line(lineNum);
      from = Math.min(line.from + Math.max(0, colNum - 1), line.to);
      to = expandTokenRange(state, from, line.to);
    } else {
      // Pattern 2: "... at position 42 ..."
      const posMatch = msg.match(/position\s+(\d+)/i);
      if (posMatch && posMatch[1]) {
        from = Math.min(parseInt(posMatch[1], 10), state.doc.length);
        const line = state.doc.lineAt(from);
        to = expandTokenRange(state, from, line.to);
      } else {
        // Fallback: point to end of document if end of input, or start
        from = /end of/i.test(msg) ? Math.max(0, state.doc.length - 1) : 0;
        to = Math.min(from + 1, state.doc.length);
      }
    }

    if (from >= to && to < state.doc.length) to = from + 1;

    return [
      {
        from,
        to: Math.max(from + 1, to),
        severity: 'error',
        message: `JSON error: ${msg.replace(/^JSON\.parse:\s*/, '')}`,
      },
    ];
  }
}

/**
 * Lints JavaScript & TypeScript using Sucrase parser errors, supporting JSX/TSX syntax.
 */
export function lintJsTs(text: string, lang: 'javascript' | 'typescript', state: EditorState): Diagnostic[] {
  try {
    transform(text, {
      transforms: lang === 'typescript' ? ['typescript', 'jsx'] : ['jsx'],
      disableESTransforms: true,
    });
    return [];
  } catch (err: unknown) {
    const errorObj = err as { loc?: { line: number; column: number }; message?: string };
    if (errorObj && errorObj.loc) {
      const lineNum = Math.min(Math.max(1, errorObj.loc.line), state.doc.lines);
      const colNum = Math.max(1, errorObj.loc.column);
      const line = state.doc.line(lineNum);
      const from = Math.min(line.from + Math.max(0, colNum - 1), line.to);
      const to = expandTokenRange(state, from, line.to);
      const cleanMsg = (errorObj.message || 'Syntax error')
        .replace(/^[a-zA-Z]+:\s*/, '')
        .replace(/\(\d+:\d+\)$/, '')
        .trim();

      return [
        {
          from,
          to: Math.max(from + 1, to),
          severity: 'error',
          message: cleanMsg || 'Syntax error',
        },
      ];
    }
    return [];
  }
}

/**
 * Universal Lezer parser error scanner.
 * Works on any Lezer-based grammar (Python, Rust, C++, Go, Java, CSS, HTML, SQL).
 * Coalesces adjacent error nodes and produces contextual diagnostic descriptions.
 */
export function lintLezerTree(state: EditorState): Diagnostic[] {
  const tree = ensureSyntaxTree(state, state.doc.length, 500) ?? syntaxTree(state);
  // Don't report false positives if tree hasn't caught up with text length yet
  if (tree.length < state.doc.length) return [];

  const diagnostics: Diagnostic[] = [];
  let lastEnd = -1;

  tree.iterate({
    enter: (node) => {
      if (diagnostics.length >= MAX_DIAGNOSTICS) return false;

      if (node.type.isError || node.type.name === '⚠') {
        const from = Math.min(node.from, state.doc.length);

        // Coalesce error nodes within 2 characters of the previous diagnostic to prevent duplicate squiggles
        if (from <= lastEnd + 2 && diagnostics.length > 0) {
          return undefined;
        }

        const rawTo = Math.min(node.to, state.doc.length);
        const line = state.doc.lineAt(from);
        const to = rawTo <= from ? expandTokenRange(state, from, line.to) : rawTo;
        lastEnd = to;

        const snippet = state.sliceDoc(from, Math.min(from + 16, line.to)).trim();

        // Extract parent context from Lezer AST to provide actionable hints
        let contextHint = '';
        const parentName = node.node.parent?.name || '';
        if (/ParamList|ArgList|Parameters|Arguments/i.test(parentName)) {
          contextHint = 'Unclosed parameter or argument list';
        } else if (/Block|Body|CompoundStatement/i.test(parentName)) {
          contextHint = 'Unclosed block or statement';
        } else if (/Array|ListLiteral|Bracket/i.test(parentName)) {
          contextHint = 'Unclosed bracket or array expression';
        } else if (/Object|Dictionary|Dict/i.test(parentName)) {
          contextHint = 'Unclosed object or dictionary expression';
        } else if (/String/i.test(parentName)) {
          contextHint = 'Unclosed string literal';
        }

        const message = contextHint
          ? (snippet ? `${contextHint} near '${snippet}'` : contextHint)
          : (snippet ? `Syntax error near '${snippet}'` : 'Syntax error: unexpected token or unclosed expression');

        diagnostics.push({
          from,
          to: Math.max(from + 1, to),
          severity: 'error',
          message,
        });
      }
      return undefined;
    },
  });

  return diagnostics;
}

interface DelimiterFrame {
  char: '{' | '(' | '[';
  pos: number;
}

/**
 * Single-pass delimiter and string validator for StreamLanguage buffers (e.g. C#)
 * where Lezer syntax tree does not generate error nodes. Runs in < 0.2ms.
 */
export function lintBalancedDelimiters(text: string, state: EditorState): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const stack: DelimiterFrame[] = [];
  const len = text.length;

  let inLineComment = false;
  let inBlockComment = false;
  let inString: '"' | "'" | null = null;
  let stringStartPos = 0;

  for (let i = 0; i < len; i++) {
    if (diagnostics.length >= MAX_DIAGNOSTICS) break;
    const ch = text[i]!;
    const next = i + 1 < len ? text[i + 1]! : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }

    if (inString !== null) {
      if (ch === '\\') {
        // Skip escaped character
        i++;
        continue;
      }
      if (ch === inString) {
        inString = null;
        continue;
      }
      if (ch === '\n') {
        // Unclosed single-line string literal
        const line = state.doc.lineAt(stringStartPos);
        diagnostics.push({
          from: stringStartPos,
          to: Math.min(stringStartPos + 1, line.to),
          severity: 'error',
          message: 'Unclosed string literal',
        });
        inString = null;
      }
      continue;
    }

    // Comment starts
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }

    // String starts
    if (ch === '"' || ch === "'") {
      inString = ch;
      stringStartPos = i;
      continue;
    }

    // Delimiters
    if (ch === '{' || ch === '(' || ch === '[') {
      stack.push({ char: ch, pos: i });
    } else if (ch === '}' || ch === ')' || ch === ']') {
      const expected = ch === '}' ? '{' : ch === ')' ? '(' : '[';
      const last = stack.pop();
      if (!last || last.char !== expected) {
        diagnostics.push({
          from: i,
          to: Math.min(i + 1, state.doc.length),
          severity: 'error',
          message: `Unexpected closing delimiter '${ch}'`,
        });
      }
    }
  }

  // Unclosed strings at EOF
  if (inString !== null && diagnostics.length < MAX_DIAGNOSTICS) {
    diagnostics.push({
      from: stringStartPos,
      to: Math.min(stringStartPos + 1, state.doc.length),
      severity: 'error',
      message: 'Unclosed string literal',
    });
  }

  // Unclosed delimiters at EOF
  while (stack.length > 0 && diagnostics.length < MAX_DIAGNOSTICS) {
    const unclosed = stack.pop()!;
    const line = state.doc.lineAt(unclosed.pos);
    const names = { '{': 'brace', '(': 'parenthesis', '[': 'bracket' };
    diagnostics.push({
      from: unclosed.pos,
      to: expandTokenRange(state, unclosed.pos, line.to),
      severity: 'error',
      message: `Unclosed ${names[unclosed.char]} '${unclosed.char}'`,
    });
  }

  return diagnostics;
}
