import { describe, expect, it } from 'vitest';
import { formatCode } from './formatter';

describe('formatCode', () => {
  it('formats javascript and typescript using prettier', async () => {
    const unformatted = 'function   add( a: number,b:number ) {return a+b;}';
    const formatted = await formatCode(unformatted, 'typescript');
    expect(formatted).toContain('function add(a: number, b: number) {');
    expect(formatted).toContain('return a + b;');
  });

  it('formats html cleanly', async () => {
    const unformatted = '<div class="card"><h1>Hello</h1><p>World</p></div>';
    const formatted = await formatCode(unformatted, 'html');
    expect(formatted).toContain('<div class="card">');
    expect(formatted).toContain('  <h1>Hello</h1>');
    expect(formatted).toContain('  <p>World</p>');
  });

  it('formats css rules cleanly', async () => {
    const unformatted = 'body{color:red;margin:0;}';
    const formatted = await formatCode(unformatted, 'css');
    expect(formatted).toContain('body {\n  color: red;');
  });

  it('formats c/cpp/csharp/java using indentation beautifier', async () => {
    const unformatted = 'public class Main {\npublic static void main(String[] args) {\nSystem.out.println("Hello");\n}\n}';
    const formatted = await formatCode(unformatted, 'java');
    expect(formatted).toContain('public class Main {');
    expect(formatted).toContain('  public static void main(String[] args) {');
    expect(formatted).toContain('    System.out.println("Hello");');
  });

  it('formats json cleanly', async () => {
    const unformatted = '{"a":1,"b":[2,3],"c":{"d":true}}';
    const formatted = await formatCode(unformatted, 'json');
    expect(formatted).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ],\n  "c": {\n    "d": true\n  }\n}\n');
  });

  it('returns empty/whitespace string unchanged', async () => {
    expect(await formatCode('', 'typescript')).toBe('');
    expect(await formatCode('   \n  ', 'c')).toBe('   \n  ');
  });
});
