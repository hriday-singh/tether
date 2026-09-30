import { buildPreviewDoc, isConsoleMessage, stripScripts } from './preview';

describe('preview builder', () => {
  it('strips scripts and inline handlers for live renders', () => {
    const out = stripScripts('<p onclick="x()">hi</p><script>while(true){}</script><script src="a.js"></script>');
    expect(out).toBe('<p>hi</p>');
  });

  it('strips an unterminated script being typed', () => {
    expect(stripScripts('<p>a</p><script>while(')).toBe('<p>a</p>');
  });

  it('keeps user scripts only on Run, and always injects the interceptor into <head>', () => {
    const src = '<html><head><title>t</title></head><body><script>console.log(1)</script></body></html>';
    const live = buildPreviewDoc('html', src, { runScripts: false, runId: 'r1' });
    const run = buildPreviewDoc('html', src, { runScripts: true, runId: 'r2' });
    expect(live).not.toContain('console.log(1)');
    expect(run).toContain('console.log(1)');
    expect(run.indexOf('sandboxed-console')).toBeLessThan(run.indexOf('<title>'));
  });

  it('cannot break out of the CSS style tag', () => {
    const out = buildPreviewDoc('css', 'a{}</style><script>alert(1)</script>', { runScripts: false, runId: 'x' });
    expect(out).not.toContain('</style><script>alert');
  });

  it('recognizes only sandbox console messages', () => {
    expect(isConsoleMessage({ source: 'sandboxed-console', type: 'log', payload: [] })).toBe(true);
    expect(isConsoleMessage({ source: 'other', type: 'log', payload: [] })).toBe(false);
    expect(isConsoleMessage(null)).toBe(false);
  });

  it('safely escapes runId containing script breakout characters', () => {
    const maliciousRunId = '</script><script>alert("pwned")</script>';
    const doc = buildPreviewDoc('html', '<p>Hello</p>', { runScripts: false, runId: maliciousRunId });
    expect(doc).not.toContain(maliciousRunId);
    expect(doc).toContain('\\u003c/script>');
  });
});
