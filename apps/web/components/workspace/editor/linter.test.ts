import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { createLinterSource, lintBalancedDelimiters, lintJson, lintJsTs, lintLezerTree } from './linter';

describe('Editor Linter', () => {
  describe('lintJson', () => {
    it('returns no diagnostics for valid JSON', () => {
      const state = EditorState.create({ doc: '{"hello": "world", "count": 42}' });
      const result = lintJson(state.doc.toString(), state);
      expect(result).toHaveLength(0);
    });

    it('returns error diagnostic for invalid JSON syntax', () => {
      const text = '{\n  "hello": "world",\n  "count": \n}';
      const state = EditorState.create({ doc: text });
      const result = lintJson(text, state);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.severity).toBe('error');
      expect(result[0]!.message).toContain('JSON error');
    });

    it('handles trailing comma or unquoted keys', () => {
      const text = '{ key: 123 }';
      const state = EditorState.create({ doc: text });
      const result = lintJson(text, state);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.severity).toBe('error');
    });
  });

  describe('lintJsTs', () => {
    it('returns no diagnostics for valid JavaScript', () => {
      const text = 'function add(a, b) { return a + b; }';
      const state = EditorState.create({ doc: text });
      const result = lintJsTs(text, 'javascript', state);
      expect(result).toHaveLength(0);
    });

    it('returns no diagnostics for valid TypeScript', () => {
      const text = 'interface User { id: string; age: number; }\nconst u: User = { id: "1", age: 30 };';
      const state = EditorState.create({ doc: text });
      const result = lintJsTs(text, 'typescript', state);
      expect(result).toHaveLength(0);
    });

    it('returns no diagnostics for valid JSX and TSX syntax', () => {
      const jsx = 'function App() { return <div className="box"><span>Hello</span></div>; }';
      const jsState = EditorState.create({ doc: jsx });
      expect(lintJsTs(jsx, 'javascript', jsState)).toHaveLength(0);

      const tsx = 'type Props = { title: string };\nconst Card = ({ title }: Props) => <h1>{title}</h1>;';
      const tsState = EditorState.create({ doc: tsx });
      expect(lintJsTs(tsx, 'typescript', tsState)).toHaveLength(0);
    });

    it('catches syntax errors in JavaScript', () => {
      const text = 'const x = ;';
      const state = EditorState.create({ doc: text });
      const result = lintJsTs(text, 'javascript', state);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.severity).toBe('error');
    });

    it('expands diagnostic range to the full token rather than a single character', () => {
      const text = 'const broken identifier = 123;';
      const state = EditorState.create({ doc: text });
      const result = lintJsTs(text, 'javascript', state);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.to - result[0]!.from).toBeGreaterThan(1);
    });
  });

  describe('lintLezerTree', () => {
    it('provides contextual error hints from Lezer AST parent nodes in Python', async () => {
      const { python } = await import('@codemirror/lang-python');
      const state = EditorState.create({
        doc: 'def calc(a, b\n    return a + b\n',
        extensions: [python()],
      });
      const diagnostics = lintLezerTree(state);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.message.toLowerCase()).toMatch(/parameter|argument|unclosed|syntax/);
    });

    it('coalesces adjacent error nodes to prevent duplicate diagnostics', async () => {
      const { python } = await import('@codemirror/lang-python');
      const state = EditorState.create({
        doc: 'def broken(::):\n  pass\n',
        extensions: [python()],
      });
      const diagnostics = lintLezerTree(state);
      expect(diagnostics.length).toBeLessThanOrEqual(2);
    });
  });

  describe('lintBalancedDelimiters (C# and stream languages)', () => {
    it('catches unclosed braces and parentheses', () => {
      const text = 'class Program {\n  void Main() {\n    Console.WriteLine("hi");\n';
      const state = EditorState.create({ doc: text });
      const diagnostics = lintBalancedDelimiters(text, state);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.message).toContain('Unclosed');
      expect(diagnostics[0]!.severity).toBe('error');
    });

    it('catches unclosed string literals', () => {
      const text = 'class Program {\n  string msg = "unclosed;\n}';
      const state = EditorState.create({ doc: text });
      const diagnostics = lintBalancedDelimiters(text, state);
      expect(diagnostics.length).toBeGreaterThan(0);
      expect(diagnostics[0]!.message).toMatch(/string/i);
    });

    it('returns empty diagnostics for balanced code', () => {
      const text = 'class Program {\n  void Main() {\n    Console.WriteLine("hi");\n  }\n}';
      const state = EditorState.create({ doc: text });
      const diagnostics = lintBalancedDelimiters(text, state);
      expect(diagnostics).toHaveLength(0);
    });
  });

  describe('createLinterSource', () => {
    it('returns empty diagnostics for empty document', () => {
      const linterFn = createLinterSource('json');
      const state = EditorState.create({ doc: '' });
      const view = { state } as unknown as EditorView;
      const result = linterFn(view);
      expect(result).toHaveLength(0);
    });

    it('routes C# to balanced delimiter scanner', () => {
      const text = 'namespace Tether {\n  class App {\n';
      const state = EditorState.create({ doc: text });
      const linterFn = createLinterSource('csharp');
      const view = { state } as unknown as EditorView;
      const result = linterFn(view);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]!.message).toContain('Unclosed');
    });
  });
});
