/**
 * What chaos-storm bots type. Each block is self-contained, so the file stays valid whichever bots
 * type concurrently, and blocks land in queue order (see botStormManager). HTML, JavaScript and
 * TypeScript are curated to add up to something worth pressing Run on; other languages are short.
 */
export interface CodeSnippet {
  code: string;
  chatStatus: string;
}

/** Blank line before, newline after; the leading newline of the template literal is dropped. */
const block = (code: string, chatStatus: string): CodeSnippet => ({ code: '\n' + code.replace(/^\n/, ''), chatStatus });

const javascript: CodeSnippet[] = [
  block(
    `
// Format a duration in ms as "1m 05s"
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return \`\${minutes}m \${seconds}s\`;
}
console.log('formatDuration:', formatDuration(65_000));
`,
    'Added formatDuration.',
  ),
  block(
    `
// Keep a number inside [min, max]
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
console.log('clamp:', clamp(42, 0, 10), clamp(-3, 0, 10));
`,
    'Added clamp.',
  ),
  block(
    `
// Group items by a key function
function groupBy(items, keyOf) {
  const groups = {};
  for (const item of items) {
    (groups[keyOf(item)] ??= []).push(item);
  }
  return groups;
}
console.log('groupBy:', groupBy(['apple', 'avocado', 'banana'], (word) => word[0]));
`,
    'Added groupBy.',
  ),
  block(
    `
// Run fn only once calls stop for waitMs
function debounce(fn, waitMs) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), waitMs);
  };
}
const saveDraft = debounce((text) => console.log('debounce: saved', JSON.stringify(text)), 50);
saveDraft('h');
saveDraft('hello');
`,
    'Added debounce.',
  ),
  block(
    `
// Structural equality for plain objects and arrays
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => deepEqual(a[k], b[k]));
}
console.log('deepEqual:', deepEqual({ x: [1, 2] }, { x: [1, 2] }), deepEqual({ x: 1 }, { x: 2 }));
`,
    'Added deepEqual.',
  ),
  block(
    `
// Tiny event emitter
function createEmitter() {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(fn);
      return () => listeners.get(event).delete(fn);
    },
    emit(event, payload) {
      listeners.get(event)?.forEach((fn) => fn(payload));
    },
  };
}
const roomEvents = createEmitter();
roomEvents.on('join', (name) => console.log('emitter:', name, 'joined'));
roomEvents.emit('join', 'Alex');
`,
    'Added an event emitter.',
  ),
  block(
    `
// Cache results of a pure one-argument function
function memoize(fn) {
  const cache = new Map();
  return (arg) => {
    if (!cache.has(arg)) cache.set(arg, fn(arg));
    return cache.get(arg);
  };
}
const square = memoize((n) => n * n);
console.log('memoize:', square(12), square(12));
`,
    'Added memoize.',
  ),
  block(
    `
// Split an array into fixed-size chunks
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
console.log('chunk:', JSON.stringify(chunk([1, 2, 3, 4, 5], 2)));
`,
    'Added chunk.',
  ),
  block(
    `
// Turn a title into a URL slug
function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^\\w\\s-]/g, '')
    .trim()
    .replace(/[\\s_-]+/g, '-');
}
console.log('slugify:', slugify('Hello, Tether World!'));
`,
    'Added slugify.',
  ),
  block(
    `
// Retry an async task with exponential backoff
async function retry(task, attempts = 3, baseMs = 20) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task(attempt);
    } catch (err) {
      if (attempt + 1 >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** attempt));
    }
  }
}
retry((attempt) => {
  if (attempt < 2) throw new Error('flaky');
  return \`ok after \${attempt + 1} tries\`;
}).then((msg) => console.log('retry:', msg));
`,
    'Added retry with backoff.',
  ),
];

const typescript: CodeSnippet[] = [
  block(
    `
// Parse JSON without throwing across boundaries
type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function parseJson<T>(raw: string): Result<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
console.log('parseJson:', parseJson<{ n: number }>('{"n":1}'), parseJson('{oops'));
`,
    'Added a typed parseJson.',
  ),
  block(
    `
// Keep a number inside a typed range
interface NumberRange {
  min: number;
  max: number;
}

function clampTo(value: number, { min, max }: NumberRange): number {
  return Math.min(Math.max(value, min), max);
}
console.log('clampTo:', clampTo(150, { min: 0, max: 100 }));
`,
    'Added clampTo.',
  ),
  block(
    `
// Group items by a key, fully typed
function groupBy<T, K extends PropertyKey>(items: readonly T[], keyOf: (item: T) => K): Partial<Record<K, T[]>> {
  const groups: Partial<Record<K, T[]>> = {};
  for (const item of items) {
    (groups[keyOf(item)] ??= []).push(item);
  }
  return groups;
}
console.log('groupBy:', groupBy([1, 2, 3, 4, 5], (n) => (n % 2 === 0 ? 'even' : 'odd')));
`,
    'Added a generic groupBy.',
  ),
  block(
    `
// Event names and payloads checked at compile time
type RoomEvents = { join: string; message: { from: string; text: string } };

class EventBus<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Array<(payload: Events[K]) => void> } = {};

  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): void {
    (this.handlers[event] ??= []).push(fn);
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers[event]?.forEach((fn) => fn(payload));
  }
}

const bus = new EventBus<RoomEvents>();
bus.on('message', ({ from, text }) => console.log('bus:', \`\${from}: \${text}\`));
bus.emit('message', { from: 'Sarah', text: 'Pushed the fix' });
`,
    'Added a typed EventBus.',
  ),
  block(
    `
// Cache entries that expire after ttlMs
class TtlCache<K, V> {
  private store = new Map<K, { value: V; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: K): V | undefined {
    const hit = this.store.get(key);
    if (!hit || hit.expiresAt < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: K, value: V): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

const scores = new TtlCache<string, number>(1_000);
scores.set('alex', 42);
console.log('ttlCache:', scores.get('alex'), scores.get('missing'));
`,
    'Added TtlCache.',
  ),
  block(
    `
// Narrow away null/undefined with a readable error
function assertDefined<T>(value: T | null | undefined, name: string): T {
  if (value == null) throw new Error(\`Expected \${name} to be defined\`);
  return value;
}
const settings = new Map([['port', 4000]]);
console.log('assertDefined: port =', assertDefined(settings.get('port'), 'port'));
`,
    'Added assertDefined.',
  ),
  block(
    `
// Exhaustive switch: a new status that is not handled fails to compile
type SyncStatus = 'online' | 'offline' | 'reconnecting';

function describeStatus(status: SyncStatus): string {
  switch (status) {
    case 'online':
      return 'All changes saved';
    case 'offline':
      return 'Edits kept on this device';
    case 'reconnecting':
      return 'Trying to reconnect';
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}
console.log('describeStatus:', describeStatus('reconnecting'));
`,
    'Added an exhaustive status switch.',
  ),
  block(
    `
// Human-readable byte sizes
function formatBytes(bytes: number, decimals = 1): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return \`\${value.toFixed(unit === 0 ? 0 : decimals)} \${units[unit]}\`;
}
console.log('formatBytes:', formatBytes(512), formatBytes(1_572_864));
`,
    'Added formatBytes.',
  ),
  block(
    `
// Retry an async task with exponential backoff
async function retry<T>(task: (attempt: number) => Promise<T> | T, attempts = 3, baseMs = 20): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await task(attempt);
    } catch (err) {
      if (attempt + 1 >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseMs * 2 ** attempt));
    }
  }
}
void retry((attempt) => {
  if (attempt < 2) throw new Error('flaky');
  return \`ok after \${attempt + 1} tries\`;
}).then((msg) => console.log('retry:', msg));
`,
    'Added a typed retry.',
  ),
];

/** Indented for the default page's <body>; typed in order just above </body>. */
const html: CodeSnippet[] = [
  block(
    `
    <!-- Page header -->
    <header>
      <h2>Team Dashboard</h2>
      <p>What the team shipped this week, in one place.</p>
    </header>
`,
    'Added the page header.',
  ),
  block(
    `
    <!-- Section links -->
    <nav aria-label="Sections">
      <ul>
        <li><a href="#tasks">Tasks</a></li>
        <li><a href="#people">People</a></li>
        <li><a href="#faq">FAQ</a></li>
      </ul>
    </nav>
`,
    'Added section links.',
  ),
  block(
    `
    <!-- Task checklist -->
    <section id="tasks">
      <h2>Tasks</h2>
      <ul>
        <li><label><input type="checkbox" checked> Set up the repo</label></li>
        <li><label><input type="checkbox" checked> Real-time sync</label></li>
        <li><label><input type="checkbox"> Write the docs</label></li>
      </ul>
      <progress value="2" max="3">2 of 3</progress>
    </section>
`,
    'Added the task checklist.',
  ),
  block(
    `
    <!-- Who is working on what -->
    <section id="people">
      <h2>People</h2>
      <table>
        <thead>
          <tr><th>Name</th><th>Focus</th></tr>
        </thead>
        <tbody>
          <tr><td>Alex</td><td>Sync engine</td></tr>
          <tr><td>Sarah</td><td>API</td></tr>
          <tr><td>Marcus</td><td>Editor UI</td></tr>
        </tbody>
      </table>
    </section>
`,
    'Added the people table.',
  ),
  block(
    `
    <!-- Highlight -->
    <blockquote>
      <p>Merge conflicts are a thing of the past.</p>
      <cite>The whole team</cite>
    </blockquote>
`,
    'Added a quote.',
  ),
  block(
    `
    <!-- Click counter: press Run to enable scripts -->
    <section id="counter">
      <h2>Counter</h2>
      <button type="button" id="count-btn">Clicked 0 times</button>
      <script>
        (() => {
          let clicks = 0;
          const btn = document.getElementById('count-btn');
          btn.addEventListener('click', () => {
            clicks++;
            btn.textContent = \`Clicked \${clicks} times\`;
          });
        })();
      </script>
    </section>
`,
    'Added a click counter.',
  ),
  block(
    `
    <!-- FAQ -->
    <section id="faq">
      <h2>FAQ</h2>
      <details>
        <summary>Do I need an account?</summary>
        <p>No. Share the room link and start typing.</p>
      </details>
      <details>
        <summary>What happens offline?</summary>
        <p>Edits stay on your device and merge when you reconnect.</p>
      </details>
    </section>
`,
    'Added the FAQ.',
  ),
  block(
    `
    <!-- Footer -->
    <footer>
      <small>Built live in Tether.</small>
    </footer>
`,
    'Added the footer.',
  ),
];

export const SNIPPETS_BY_LANG: Record<string, CodeSnippet[]> = {
  javascript,
  typescript,
  html,
  python: [
    {
      code: `\n# Helper: calculate moving average\ndef moving_average(values: list[float], window: int) -> list[float]:\n    if window <= 0 or not values:\n        return []\n    return [sum(values[i:i+window]) / window for i in range(len(values) - window + 1)]\n`,
      chatStatus: 'Added moving average helper in Python.',
    },
    {
      code: `\n# Utility: exponential backoff retry\ndef retry_operation(fn, max_retries: int = 3):\n    for attempt in range(max_retries):\n        try:\n            return fn()\n        except Exception:\n            if attempt == max_retries - 1:\n                raise\n`,
      chatStatus: 'Added retry_operation utility.',
    },
    {
      code: `\n# Decorator: memoize pure function results\nfrom functools import wraps\ndef memoize(fn):\n    cache = {}\n    @wraps(fn)\n    def wrapper(*args):\n        if args not in cache:\n            cache[args] = fn(*args)\n        return cache[args]\n    return wrapper\n`,
      chatStatus: 'Implemented memoize decorator.',
    },
    {
      code: `\n# Helper: process items in fixed-size batches\ndef batched(iterable, n: int):\n    from itertools import islice\n    it = iter(iterable)\n    while batch := list(islice(it, n)):\n        yield batch\n`,
      chatStatus: 'Added batch processing generator.',
    },
  ],
  rust: [
    {
      code: `\npub fn clamp_num<T: PartialOrd>(val: T, min: T, max: T) -> T {\n    if val < min { min } else if val > max { max } else { val }\n}\n`,
      chatStatus: 'Added clamp_num implementation in Rust.',
    },
    {
      code: `\n/// Retry a fallible operation with exponential backoff.\npub fn retry<F, T, E>(mut f: F, max: usize) -> Result<T, E>\nwhere\n    F: FnMut() -> Result<T, E>,\n{\n    let mut last_err = None;\n    for _ in 0..max {\n        match f() {\n            Ok(v) => return Ok(v),\n            Err(e) => last_err = Some(e),\n        }\n    }\n    Err(last_err.unwrap())\n}\n`,
      chatStatus: 'Added retry helper in Rust.',
    },
  ],
  go: [
    {
      code: `\n// ClampInt restricts a value within min and max\nfunc ClampInt(val, min, max int) int {\n\tif val < min {\n\t\treturn min\n\t}\n\tif val > max {\n\t\treturn max\n\t}\n\treturn val\n}\n`,
      chatStatus: 'Implemented ClampInt helper in Go.',
    },
    {
      code: `\n// SafeGo runs fn in a goroutine and recovers panics.\nfunc SafeGo(fn func()) {\n\tgo func() {\n\t\tdefer func() {\n\t\t\tif r := recover(); r != nil {\n\t\t\t\tlog.Printf("recovered panic: %v", r)\n\t\t\t}\n\t\t}()\n\t\tfn()\n\t}()\n}\n`,
      chatStatus: 'Added SafeGo panic recovery wrapper.',
    },
  ],
  css: [
    {
      code: `\n/* Flexbox layout utility */\n.flex-center {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n}\n`,
      chatStatus: 'Added flexbox alignment rules.',
    },
    {
      code: `\n/* Smooth fade-in animation */\n@keyframes fade-in {\n  from { opacity: 0; transform: translateY(4px); }\n  to   { opacity: 1; transform: translateY(0); }\n}\n.fade-in {\n  animation: fade-in 0.2s ease-out;\n}\n`,
      chatStatus: 'Added fade-in animation keyframes.',
    },
  ],
};

/** Languages without their own list borrow JavaScript's. */
export function snippetsFor(language: string): CodeSnippet[] {
  return SNIPPETS_BY_LANG[language.toLowerCase()] ?? javascript;
}
