'use client';

import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState } from '@codemirror/state';
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import type { Member } from '@tether/shared';
import { useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { usePrefs } from '@/components/providers';
import { useStore } from '@/lib/hooks';
import { languageInfo } from '@/lib/languages';
import { loadPreferences } from '@/lib/prefs';
import { useWorkspace } from '../context';
import { collab, peersFacet, toggleLineHighlight, type PeerInfo } from './collab';
import { bracketColors, createLinterExtension, editorFontSizeTheme, loadLanguage, quietHighlight, quietTheme } from './setup';

function peersOf(roster: readonly Member[]): ReadonlyMap<string, PeerInfo> {
  return new Map(roster.map((m) => [m.id, { name: m.name, colorIndex: m.colorIndex }]));
}

/**
 * CodeMirror 6 bound to the room's Y.Text. The document never enters React state (docs/07):
 * React only reconfigures compartments when prefs, language or roster change.
 */
export default function Editor({ readOnly = false }: { readOnly?: boolean }) {
  const ws = useWorkspace();
  const { client } = ws;
  const { prefs } = usePrefs();
  const host = useRef<HTMLDivElement>(null);
  const roster = useStore(client.roster);
  const language = useStore(client.room).room.language;
  const c = useRef({
    fontSize: new Compartment(),
    language: new Compartment(),
    peers: new Compartment(),
    gutter: new Compartment(),
    wrap: new Compartment(),
    tabs: new Compartment(),
    brackets: new Compartment(),
    readOnly: new Compartment(),
    linter: new Compartment(),
  }).current;

  // Mount once per client.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const undoManager = new Y.UndoManager(client.text);
    const view = new EditorView({
      parent: el,
      state: EditorState.create({
        doc: client.text.toString(),
        extensions: [
          c.fontSize.of(editorFontSizeTheme(prefs.editorFontSize)),
          c.gutter.of(prefs.lineNumbers ? [lineNumbers(gutterHandlers(ws)), highlightActiveLineGutter()] : []),
          highlightActiveLine(),
          drawSelection(),
          dropCursor(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          search({ top: true }),
          quietTheme,
          quietHighlight,
          c.brackets.of(prefs.bracketColors ? bracketColors : []),
          c.tabs.of([EditorState.tabSize.of(prefs.tabSize), indentUnit.of(' '.repeat(prefs.tabSize))]),
          c.wrap.of(prefs.wordWrap ? EditorView.lineWrapping : []),
          c.language.of([]),
          c.linter.of(createLinterExtension(languageInfo(language).id)),
          c.readOnly.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          yCollab(client.text, null, { undoManager }),
          c.peers.of(peersFacet.of(peersOf(client.roster.get()))),
          collab(
            {
              ytext: client.text,
              awareness: client.awareness,
              selfMemberId: ws.session.memberId,
              onOffscreen: (list) => ws.offscreen.set(list),
            },
          ),
          keymap.of([
            { key: 'Alt-h', run: (v) => (toggleLineHighlight(v, client.awareness, client.text), true) },
            ...closeBracketsKeymap,
            ...yUndoManagerKeymap,
            ...searchKeymap,
            ...defaultKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => {
            if (!u.selectionSet && !u.docChanged) return;
            const sel = u.state.selection.main;
            const line = u.state.doc.lineAt(sel.head);
            ws.cursorPos.set({ line: line.number, col: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from) });
          }),
          EditorView.domEventHandlers({
            // Own keypress or scroll stops follow, unless the user turned that off in Settings > Collaboration.
            keydown: () => {
              if (ws.follow.get() && loadPreferences().followUnlockOnInput) ws.follow.set(null);
              return false;
            },
            wheel: () => {
              if (ws.follow.get() && loadPreferences().followUnlockOnInput) ws.follow.set(null);
              return false;
            },
          }),
          EditorView.contentAttributes.of({ 'aria-label': 'Shared code editor' }),
        ],
      }),
    });
    ws.setView(view);
    return () => {
      ws.setView(null);
      view.destroy();
      undoManager.destroy();
    };
    // Prefs/readOnly apply through compartments below; remounting would drop selection and scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  const reconfigure = (compartment: Compartment, ext: Parameters<Compartment['reconfigure']>[0]): void => {
    ws.view.current?.dispatch({ effects: compartment.reconfigure(ext) });
  };

  useEffect(() => {
    let cancelled = false;
    const langId = languageInfo(language).id;
    reconfigure(c.linter, createLinterExtension(langId));
    void loadLanguage(langId).then((support) => {
      if (!cancelled) reconfigure(c.language, support);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => reconfigure(c.peers, peersFacet.of(peersOf(roster))), [roster]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => reconfigure(c.gutter, prefs.lineNumbers ? [lineNumbers(gutterHandlers(ws)), highlightActiveLineGutter()] : []),
    [prefs.lineNumbers], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => reconfigure(c.wrap, prefs.wordWrap ? EditorView.lineWrapping : []), [prefs.wordWrap]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => reconfigure(c.brackets, prefs.bracketColors ? bracketColors : []), [prefs.bracketColors]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => reconfigure(c.tabs, [EditorState.tabSize.of(prefs.tabSize), indentUnit.of(' '.repeat(prefs.tabSize))]),
    [prefs.tabSize], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(
    () => reconfigure(c.readOnly, [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    [readOnly], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    reconfigure(c.fontSize, editorFontSizeTheme(prefs.editorFontSize));
    ws.view.current?.requestMeasure();
    const id = requestAnimationFrame(() => {
      ws.view.current?.requestMeasure();
    });
    return () => cancelAnimationFrame(id);
  }, [prefs.editorFontSize]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={host}
      className="h-full min-h-0 overflow-hidden"
      style={
        {
          '--editor-font-size': `${prefs.editorFontSize}px`,
          '--flag-fade': `${prefs.cursorFlagFadeSeconds}s`,
        } as React.CSSProperties
      }
    />
  );
}

function gutterHandlers(ws: ReturnType<typeof useWorkspace>) {
  return {
    domEventHandlers: {
      mousedown(view: EditorView, line: { from: number }) {
        toggleLineHighlight(view, ws.client.awareness, ws.client.text, view.state.doc.lineAt(line.from).number);
        return true;
      },
    },
  };
}
