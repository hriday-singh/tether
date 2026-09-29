import { Annotation, Facet, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { presenceClass } from '@/components/ui/avatar';

/**
 * Remote cursors, selections and line highlights, resolved against the server roster (docs/04: name and
 * color are never read from awareness, so nobody can impersonate a name). Also writes the local cursor into
 * awareness as relative positions, and reports off-screen cursors for the edge chips.
 */
export interface PeerInfo {
  name: string;
  colorIndex: number;
}
export const peersFacet = Facet.define<ReadonlyMap<string, PeerInfo>, ReadonlyMap<string, PeerInfo>>({
  combine: (values) => values.at(-1) ?? new Map(),
});

export interface OffscreenCursor {
  clientId: number;
  memberId: string;
  name: string;
  colorIndex: number;
  line: number;
  pos: number;
  edge: 'top' | 'bottom';
}

export interface CollabOptions {
  ytext: Y.Text;
  awareness: Awareness;
  selfMemberId: string;
  onOffscreen(list: OffscreenCursor[]): void;
}
const optionsFacet = Facet.define<CollabOptions, CollabOptions | null>({ combine: (v) => v[0] ?? null });
const refresh = Annotation.define<true>();

type RelJSON = Record<string, unknown>;
interface AwState {
  memberId?: unknown;
  cursor?: { anchor: RelJSON; head: RelJSON } | null;
  highlight?: { from: RelJSON; to: RelJSON } | null;
}

function absolute(rel: RelJSON | undefined, ytext: Y.Text): number | null {
  if (!rel || !ytext.doc) return null;
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), ytext.doc);
    return abs && abs.type === ytext ? abs.index : null;
  } catch {
    return null;
  }
}

const rel = (ytext: Y.Text, index: number) =>
  Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(ytext, index)) as RelJSON;

class CaretWidget extends WidgetType {
  constructor(
    readonly name: string,
    readonly cls: string,
    readonly stamp: number,
  ) {
    super();
  }
  eq(other: CaretWidget) {
    return other.name === this.name && other.cls === this.cls && other.stamp === this.stamp;
  }
  toDOM() {
    const caret = document.createElement('span');
    caret.className = `cm-remote-caret ${this.cls}`;
    caret.setAttribute('aria-hidden', 'true');
    const flag = document.createElement('span');
    flag.className = 'cm-remote-flag';
    flag.textContent = this.name;
    caret.append('⁠', flag, '⁠');
    return caret;
  }
  ignoreEvent() {
    return true;
  }
}

/** Head position of a remote client's cursor, for jump/follow. */
export function remoteHead(awareness: Awareness, ytext: Y.Text, clientId: number): number | null {
  const state = awareness.getStates().get(clientId) as AwState | undefined;
  return absolute(state?.cursor?.head, ytext);
}

const collabPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet = Decoration.none;
    private stamps = new Map<number, { key: string; at: number }>();
    private lastOffscreen = '';
    private readonly listener: (c: { added: number[]; updated: number[]; removed: number[] }) => void;
    private readonly opts: CollabOptions;

    constructor(private readonly view: EditorView) {
      this.opts = view.state.facet(optionsFacet)!;
      this.listener = ({ added, updated, removed }) => {
        const self = this.opts.awareness.clientID;
        if (added.concat(updated, removed).some((id) => id !== self)) {
          queueMicrotask(() => this.view.dispatch({ annotations: refresh.of(true) }));
        }
      };
      this.opts.awareness.on('change', this.listener);
      this.decorations = this.build(view.state);
    }

    destroy() {
      this.opts.awareness.off('change', this.listener);
    }

    update(u: ViewUpdate) {
      this.writeLocalCursor(u);
      this.decorations = this.build(u.state);
      this.reportOffscreen(u.view);
    }

    private writeLocalCursor(u: ViewUpdate) {
      const { awareness, ytext } = this.opts;
      const local = awareness.getLocalState() as AwState | null;
      if (!local) return;
      const hasFocus = u.view.hasFocus && u.view.dom.ownerDocument.hasFocus();
      if (!hasFocus) return;
      if (!u.selectionSet && !u.focusChanged && !u.docChanged && local.cursor) return;
      const sel = u.state.selection.main;
      const next = { anchor: rel(ytext, sel.anchor), head: rel(ytext, sel.head) };
      if (JSON.stringify(next) !== JSON.stringify(local.cursor ?? null)) {
        awareness.setLocalStateField('cursor', next);
      }
    }

    private build(state: EditorState): DecorationSet {
      const { awareness, ytext } = this.opts;
      const peers = state.facet(peersFacet);
      const decos = [];
      const now = Date.now();
      const docLen = state.doc.length;
      for (const [clientId, raw] of awareness.getStates()) {
        const s = raw as AwState;
        const memberId = typeof s.memberId === 'string' ? s.memberId : null;
        const peer = memberId ? peers.get(memberId) : undefined;
        if (!memberId || !peer) continue;
        const cls = presenceClass(peer.colorIndex);
        const isSelf = clientId === awareness.clientID;

        if (s.highlight) {
          const from = absolute(s.highlight.from, ytext);
          const to = absolute(s.highlight.to, ytext);
          if (from !== null && to !== null && from <= docLen && to <= docLen) {
            const l1 = state.doc.lineAt(Math.min(from, to)).number;
            const l2 = state.doc.lineAt(Math.max(from, to)).number;
            for (let l = l1; l <= Math.min(l2, l1 + 500); l++) {
              decos.push(Decoration.line({ class: `cm-remote-hl ${cls}` }).range(state.doc.line(l).from));
            }
          }
        }
        if (isSelf || !s.cursor) continue;
        const anchor = absolute(s.cursor.anchor, ytext);
        const head = absolute(s.cursor.head, ytext);
        if (anchor === null || head === null || head > docLen || anchor > docLen) continue;
        const key = `${anchor}:${head}`;
        const prev = this.stamps.get(clientId);
        const stamp = prev && prev.key === key ? prev.at : now;
        this.stamps.set(clientId, { key, at: stamp });
        if (anchor !== head) {
          decos.push(
            Decoration.mark({ class: `cm-remote-sel ${cls}` }).range(Math.min(anchor, head), Math.max(anchor, head)),
          );
        }
        decos.push(
          Decoration.widget({ widget: new CaretWidget(peer.name, cls, stamp), side: head > anchor ? -1 : 1 }).range(head),
        );
      }
      return Decoration.set(decos, true);
    }

    reportOffscreen(view: EditorView) {
      const { awareness, ytext, onOffscreen } = this.opts;
      const peers = view.state.facet(peersFacet);
      const list: OffscreenCursor[] = [];
      for (const [clientId, raw] of awareness.getStates()) {
        if (clientId === awareness.clientID) continue;
        const s = raw as AwState;
        const memberId = typeof s.memberId === 'string' ? s.memberId : null;
        const peer = memberId ? peers.get(memberId) : undefined;
        const head = absolute(s.cursor?.head, ytext);
        if (!memberId || !peer || head === null || head > view.state.doc.length) continue;
        // Compare the line's block against the scroll viewport (visibleRanges include a render margin).
        const block = view.lineBlockAt(head);
        const top = view.scrollDOM.scrollTop;
        const y = block.top + view.documentPadding.top;
        const edge = y + block.height <= top ? 'top' : y >= top + view.scrollDOM.clientHeight ? 'bottom' : null;
        if (!edge) continue;
        list.push({ clientId, memberId, name: peer.name, colorIndex: peer.colorIndex, line: view.state.doc.lineAt(head).number, pos: head, edge });
      }
      const key = JSON.stringify(list);
      if (key !== this.lastOffscreen) {
        this.lastOffscreen = key;
        onOffscreen(list);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    eventHandlers: {
      scroll(_e, view) {
        this.reportOffscreen(view);
      },
    },
  },
);

/** Alt+H / gutter click: toggle a shared highlight on the selected lines. */
export function toggleLineHighlight(view: EditorView, awareness: Awareness, ytext: Y.Text, lineNumber?: number): void {
  const doc = view.state.doc;
  const sel = view.state.selection.main;
  const fromLine = lineNumber ? doc.line(lineNumber) : doc.lineAt(sel.from);
  const toLine = lineNumber ? fromLine : doc.lineAt(sel.to);
  const current = (awareness.getLocalState() as AwState | null)?.highlight;
  const curFrom = absolute(current?.from, ytext);
  const curTo = absolute(current?.to, ytext);
  const same =
    curFrom !== null && curTo !== null && doc.lineAt(curFrom).number === fromLine.number && doc.lineAt(curTo).number === toLine.number;
  awareness.setLocalStateField('highlight', same ? null : { from: rel(ytext, fromLine.from), to: rel(ytext, toLine.to) });
}

export const collabTheme = EditorView.baseTheme({
  '.cm-remote-caret': {
    position: 'relative',
    borderLeft: '2px solid var(--p)',
    marginLeft: '-1px',
    marginRight: '-1px',
    boxSizing: 'border-box',
  },
  '.cm-remote-flag': {
    position: 'absolute',
    bottom: '100%',
    left: '-2px',
    padding: '0 6px',
    borderRadius: '6px 6px 6px 0',
    background: 'var(--p)',
    color: 'var(--presence-ink)',
    font: '500 var(--text-micro)/1.5 var(--font-sans)',
    whiteSpace: 'nowrap',
    pointerEvents: 'none',
    userSelect: 'none',
    zIndex: '10',
    animation: 'cm-flag-fade var(--duration-base) ease-out var(--flag-fade, 2s) forwards',
  },
  '.cm-remote-caret:hover .cm-remote-flag': { animation: 'none', opacity: '1' },
  '@keyframes cm-flag-fade': { to: { opacity: '0' } },
  '.cm-remote-sel': { backgroundColor: 'color-mix(in oklch, var(--p) var(--presence-tint), transparent)' },
  '.cm-remote-hl': {
    backgroundColor: 'color-mix(in oklch, var(--p) 10%, transparent)',
    boxShadow: 'inset 3px 0 0 var(--p)',
  },
});

export function collab(opts: CollabOptions, peers: ReadonlyMap<string, PeerInfo>): Extension {
  return [optionsFacet.of(opts), peersFacet.of(peers), collabPlugin, collabTheme];
}
