import type { LanguageId } from './languages';

/**
 * Cleanly formats code for the specified language.
 * Uses Prettier standalone for supported web formats (TS, JS, HTML, CSS, Markdown),
 * and an intelligent indentation beautifier for C, C++, C#, Java, Python, Go, Rust, and SQL.
 */
export async function formatCode(code: string, languageId: LanguageId): Promise<string> {
  const trimmed = code.trim();
  if (!trimmed) return code;

  try {
    switch (languageId) {
      case 'javascript':
      case 'typescript': {
        const prettier = await import('prettier/standalone');
        const parserBabel = await import('prettier/plugins/babel');
        const parserEstree = await import('prettier/plugins/estree');
        const parserTs = await import('prettier/plugins/typescript');
        return await prettier.format(code, {
          parser: languageId === 'typescript' ? 'typescript' : 'babel',
          plugins: [parserBabel.default, parserEstree.default, parserTs.default],
          semi: true,
          singleQuote: true,
          trailingComma: 'es5',
          tabWidth: 2,
        });
      }
      case 'html': {
        const prettier = await import('prettier/standalone');
        const parserHtml = await import('prettier/plugins/html');
        return await prettier.format(code, {
          parser: 'html',
          plugins: [parserHtml.default],
          tabWidth: 2,
        });
      }
      case 'css': {
        const prettier = await import('prettier/standalone');
        const parserPostcss = await import('prettier/plugins/postcss');
        return await prettier.format(code, {
          parser: 'css',
          plugins: [parserPostcss.default],
          tabWidth: 2,
        });
      }
      case 'markdown': {
        const prettier = await import('prettier/standalone');
        const parserMarkdown = await import('prettier/plugins/markdown');
        return await prettier.format(code, {
          parser: 'markdown',
          plugins: [parserMarkdown.default],
        });
      }
      case 'json': {
        try {
          return JSON.stringify(JSON.parse(code), null, 2) + '\n';
        } catch {
          return beautifyIndentation(code, languageId);
        }
      }
      default:
        return beautifyIndentation(code, languageId);
    }
  } catch {
    // If Prettier fails on syntax errors (common while typing), fallback to indentation beautifier
    return beautifyIndentation(code, languageId);
  }
}

/**
 * Fallback and general-purpose indentation beautifier for C, C++, C#, Java, Python, Go, Rust, and SQL.
 */
function beautifyIndentation(code: string, languageId: LanguageId): string {
  const lines = code.split(/\r?\n/);
  const indentStep = languageId === 'python' || languageId === 'c' || languageId === 'cpp' || languageId === 'csharp' || languageId === 'java' ? 4 : 2;
  const indentStr = ' '.repeat(indentStep);

  let currentIndent = 0;
  const result: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      result.push('');
      continue;
    }

    // Python is indentation-sensitive, so just trim trailing whitespace to prevent syntax corruption
    if (languageId === 'python') {
      result.push(rawLine.trimEnd());
      continue;
    }

    // Closing brackets reduce indent before line is output
    const leadingCloses = (trimmed.match(/^[}\])]/) || []).length;
    if (leadingCloses > 0) {
      currentIndent = Math.max(0, currentIndent - 1);
    }

    result.push(indentStr.repeat(currentIndent) + trimmed);

    // Count open vs close brackets on this line (excluding strings/chars where possible)
    let opens = 0;
    let closes = 0;
    let inString = false;
    let quoteChar = '';

    for (let i = 0; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if ((ch === '"' || ch === "'") && trimmed[i - 1] !== '\\') {
        if (!inString) {
          inString = true;
          quoteChar = ch;
        } else if (quoteChar === ch) {
          inString = false;
        }
      } else if (!inString) {
        if (ch === '{') opens++;
        else if (ch === '}') closes++;
      }
    }

    // Net change for next line, discounting any leading close bracket already deducted
    const net = opens - closes + (leadingCloses > 0 ? 1 : 0);
    currentIndent = Math.max(0, currentIndent + net);
  }

  return result.join('\n');
}
