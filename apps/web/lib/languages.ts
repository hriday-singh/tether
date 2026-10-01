export const LANGUAGE_IDS = [
  'javascript',
  'typescript',
  'html',
  'css',
  'python',
  'go',
  'rust',
  'c',
  'cpp',
  'csharp',
  'java',
  'markdown',
  'json',
  'sql',
] as const;
export type LanguageId = (typeof LANGUAGE_IDS)[number];

export type PreviewMode = 'html' | 'css' | 'markdown' | 'json' | null;

export interface LanguageInfo {
  id: LanguageId;
  label: string;
  ext: string;
  /** Live preview mode (iframe for html/css, rendered markdown, or collapsible json tree). */
  preview: PreviewMode;
  /** Runs in the Web Worker runner (Run button, 5 s watchdog). */
  runnable: boolean;
}

export const LANGUAGES: Record<LanguageId, LanguageInfo> = {
  javascript: { id: 'javascript', label: 'JavaScript', ext: 'js', preview: null, runnable: true },
  typescript: { id: 'typescript', label: 'TypeScript', ext: 'ts', preview: null, runnable: true },
  html: { id: 'html', label: 'HTML', ext: 'html', preview: 'html', runnable: false },
  css: { id: 'css', label: 'CSS', ext: 'css', preview: 'css', runnable: false },
  python: { id: 'python', label: 'Python', ext: 'py', preview: null, runnable: false },
  go: { id: 'go', label: 'Go', ext: 'go', preview: null, runnable: false },
  rust: { id: 'rust', label: 'Rust', ext: 'rs', preview: null, runnable: false },
  c: { id: 'c', label: 'C', ext: 'c', preview: null, runnable: false },
  cpp: { id: 'cpp', label: 'C++', ext: 'cpp', preview: null, runnable: false },
  csharp: { id: 'csharp', label: 'C#', ext: 'cs', preview: null, runnable: false },
  java: { id: 'java', label: 'Java', ext: 'java', preview: null, runnable: false },
  markdown: { id: 'markdown', label: 'Markdown', ext: 'md', preview: 'markdown', runnable: false },
  json: { id: 'json', label: 'JSON', ext: 'json', preview: 'json', runnable: false },
  sql: { id: 'sql', label: 'SQL', ext: 'sql', preview: null, runnable: false },
};

export function isLanguageId(v: unknown): v is LanguageId {
  return typeof v === 'string' && (LANGUAGE_IDS as readonly string[]).includes(v);
}

export function languageInfo(id: string): LanguageInfo {
  return isLanguageId(id) ? LANGUAGES[id] : LANGUAGES.javascript;
}

export const STARTER_CODE: Record<LanguageId, string> = {
  javascript: `// Tether — every keystroke here is shared with the room.\nfunction greet(name) {\n  return \`Hello, \${name}!\`;\n}\n\nconsole.log(greet('Tether'));\n`,
  typescript: `// Tether — every keystroke here is shared with the room.\ntype Peer = { name: string; latencyMs: number };\n\nconst peers: Peer[] = [{ name: 'Laasya', latencyMs: 24 }];\nconsole.log(peers.map((p) => \`\${p.name}: \${p.latencyMs} ms\`).join('\n'));\n`,
  html: `<!DOCTYPE html>\n<html>\n  <head>\n    <style>\n      body { font-family: system-ui; padding: 2rem; }\n    </style>\n  </head>\n  <body>\n    <h1>Tether</h1>\n    <p>Edit together. Preview updates as you type.</p>\n    <script>\n      console.log('Preview scripts run when you press Run.');\n    </script>\n  </body>\n</html>\n`,
  css: `/* Styles apply to the preview sample markup. */\nbody {\n  font-family: system-ui;\n  padding: 2rem;\n}\n\nh1 {\n  letter-spacing: -0.02em;\n}\n`,
  python: `# Tether — shared Python scratchpad (syntax only, no execution)\ndef greet(name: str) -> str:\n    return f"Hello, {name}!"\n\nprint(greet("Tether"))\n`,
  go: `package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, Tether")\n}\n`,
  rust: `fn main() {\n    println!("Hello, Tether");\n}\n`,
  c: `// Tether — shared C buffer\n#include <stdio.h>\n\nint main(void) {\n    printf("Hello, Tether!\\n");\n    return 0;\n}\n`,
  cpp: `// Tether — shared C++ buffer\n#include <iostream>\n\nint main() {\n    std::cout << "Hello, Tether!" << std::endl;\n    return 0;\n}\n`,
  csharp: `// Tether — shared C# buffer\nusing System;\n\nnamespace Tether {\n    class Program {\n        static void Main(string[] args) {\n            Console.WriteLine("Hello, Tether!");\n        }\n    }\n}\n`,
  java: `// Tether — shared Java buffer\npublic class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello, Tether!");\n    }\n}\n`,
  markdown: `# Tether notes\n\n- Edit together\n- Nothing gets lost\n`,
  json: `{\n  "project": "Tether",\n  "version": "1.0.0",\n  "collaborative": true,\n  "features": [\n    "crdt-sync",\n    "sandboxed-execution",\n    "multi-format-preview",\n    "in-browser-linter"\n  ]\n}\n`,
  sql: `SELECT id, name\nFROM members\nWHERE room_id = 'demo'\nORDER BY joined_at;\n`,
};
