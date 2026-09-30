import * as Y from 'yjs';

export interface EditSummaryPayload {
  inserted: number;
  deleted: number;
  lines: [number, number];
}

export interface EditCoalescerOptions {
  idleMs?: number; // default: 5000ms
  maxWindowMs?: number; // default: 30000ms
  clock?: () => number;
  onEmitSummary: (memberId: string, memberName: string, summary: EditSummaryPayload) => void;
}

interface MemberEditSession {
  memberId: string;
  memberName: string;
  inserted: number;
  deleted: number;
  minLine: number;
  maxLine: number;
  startedAt: number;
  idleTimer: NodeJS.Timeout | null;
  maxTimer: NodeJS.Timeout | null;
}

// indexOf hops newline to newline natively; much faster than a per-char loop on large docs.
function countNewlinesBefore(text: string, end: number): number {
  let count = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < end; i = text.indexOf('\n', i + 1)) count++;
  return count;
}

function getLineNumber(text: string, index: number): number {
  return 1 + countNewlinesBefore(text, index);
}

function countNewlines(str: string): number {
  return countNewlinesBefore(str, str.length);
}

export class EditSummaryCoalescer {
  private sessions = new Map<string, MemberEditSession>();
  private idleMs: number;
  private maxWindowMs: number;
  private clock: () => number;
  private onEmitSummary: (memberId: string, memberName: string, summary: EditSummaryPayload) => void;
  private textObserver?: (event: Y.YTextEvent, transaction: Y.Transaction) => void;
  private yText: Y.Text;

  constructor(private doc: Y.Doc, options: EditCoalescerOptions) {
    this.idleMs = options.idleMs ?? 5000;
    this.maxWindowMs = options.maxWindowMs ?? 30000;
    this.clock = options.clock ?? (() => Date.now());
    this.onEmitSummary = options.onEmitSummary;

    this.yText = this.doc.getText('codemirror');
    this.attachObserver();
  }

  private attachObserver(): void {
    this.textObserver = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      const origin = transaction.origin;
      if (!origin || typeof origin !== 'object' || !('memberId' in origin)) {
        return;
      }

      const { memberId, name } = origin as { memberId: string; name?: string };
      const memberName = name ?? 'User';

      let inserted = 0;
      let deleted = 0;
      let minLine = Infinity;
      let maxLine = 1;

      // ponytail: event.delta walks every item (O(doc) per update). A hand-rolled item walk
      // benchmarked the same, so this stays on the public API.
      const fullText = this.yText.toString();
      let currPos = 0;

      for (const op of event.delta) {
        if (op.retain !== undefined) {
          currPos += op.retain;
        } else if (op.insert !== undefined) {
          const insertStr = typeof op.insert === 'string' ? op.insert : '';
          inserted += insertStr.length;
          const startLine = getLineNumber(fullText, currPos);
          const endLine = startLine + countNewlines(insertStr);
          minLine = Math.min(minLine, startLine);
          maxLine = Math.max(maxLine, endLine);
          currPos += insertStr.length;
        } else if (op.delete !== undefined) {
          deleted += op.delete;
          const line = getLineNumber(fullText, currPos);
          minLine = Math.min(minLine, line);
          maxLine = Math.max(maxLine, line);
        }
      }

      if (minLine === Infinity) {
        minLine = 1;
      }

      this.recordEdit(memberId, memberName, inserted, deleted, [minLine, maxLine]);
    };

    this.yText.observe(this.textObserver);
  }

  public recordEdit(
    memberId: string,
    memberName: string,
    inserted: number,
    deleted: number,
    lines: [number, number]
  ): void {
    const now = this.clock();
    let session = this.sessions.get(memberId);

    if (!session) {
      session = {
        memberId,
        memberName,
        inserted: 0,
        deleted: 0,
        minLine: lines[0],
        maxLine: lines[1],
        startedAt: now,
        idleTimer: null,
        maxTimer: null,
      };

      // Set max ceiling timer (30s)
      session.maxTimer = setTimeout(() => {
        this.flushMember(memberId);
      }, this.maxWindowMs);

      this.sessions.set(memberId, session);
    }

    session.memberName = memberName;
    session.inserted += inserted;
    session.deleted += deleted;
    session.minLine = Math.min(session.minLine, lines[0]);
    session.maxLine = Math.max(session.maxLine, lines[1]);

    // Reset idle timer (5s)
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }
    session.idleTimer = setTimeout(() => {
      this.flushMember(memberId);
    }, this.idleMs);
  }

  public flushMember(memberId: string): void {
    const session = this.sessions.get(memberId);
    if (!session) return;

    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
      session.idleTimer = null;
    }
    if (session.maxTimer) {
      clearTimeout(session.maxTimer);
      session.maxTimer = null;
    }

    this.sessions.delete(memberId);

    if (session.inserted > 0 || session.deleted > 0) {
      this.onEmitSummary(session.memberId, session.memberName, {
        inserted: session.inserted,
        deleted: session.deleted,
        lines: [session.minLine, session.maxLine],
      });
    }
  }

  public flushAll(): void {
    const memberIds = Array.from(this.sessions.keys());
    for (const memberId of memberIds) {
      this.flushMember(memberId);
    }
  }

  public destroy(): void {
    if (this.textObserver) {
      this.yText.unobserve(this.textObserver);
      this.textObserver = undefined;
    }
    this.flushAll();
  }
}
