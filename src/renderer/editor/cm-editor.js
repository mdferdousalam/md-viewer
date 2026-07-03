/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
'use strict';

// A CodeMirror 6 editor wrapped in a *textarea-shaped facade* so the rest of the
// renderer (and the control-API/MCP `edit` ops) can keep using the same idioms
// they used with the old <textarea>: `.value` get/set, `selectionStart/End`,
// `setRangeText`, `setSelectionRange`, `focus`, and `scrollTop/scrollHeight/
// clientHeight`. This keeps the migration surgical — no main/preload/MCP changes.

import { EditorState, Compartment, RangeSetBuilder } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, placeholder as cmPlaceholder,
  ViewPlugin, Decoration,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import {
  syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap,
  syntaxTree,
} from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

// Markdown token colours mapped to the app's existing CSS variables so the editor
// re-themes automatically with `data-theme` (no per-theme JS reconfigure of colours).
const mdHighlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--accent-text)', fontWeight: '680' },
  { tag: t.heading1, color: 'var(--accent-text)', fontWeight: '700' },
  { tag: t.heading2, color: 'var(--accent-text)', fontWeight: '700' },
  { tag: t.strong, fontWeight: '700', color: 'var(--text)' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', color: 'var(--text-dim)' },
  { tag: t.link, color: 'var(--accent-text)' },
  { tag: t.url, color: 'var(--accent-text)' },
  { tag: t.monospace, color: 'var(--hl-string)' },
  { tag: t.quote, color: 'var(--text-2)', fontStyle: 'italic' },
  { tag: t.list, color: 'var(--text-dim)' },
  { tag: t.contentSeparator, color: 'var(--text-dim)' },
  { tag: t.processingInstruction, color: 'var(--text-dim)' },
  { tag: t.meta, color: 'var(--hl-meta)' },
  { tag: t.comment, color: 'var(--hl-comment)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--hl-keyword)' },
  { tag: t.atom, color: 'var(--hl-number)' },
  { tag: t.number, color: 'var(--hl-number)' },
  { tag: t.string, color: 'var(--hl-string)' },
]);

// Chrome/layout mapped to the app tokens. Colours are all CSS vars so they switch
// with the theme; only the {dark} flag is theme-reactive (see reconfigureTheme).
const baseTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--text)', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)', fontSize: '14.5px', lineHeight: '1.75', overflow: 'auto',
  },
  '.cm-content': { padding: '28px 40px 60px', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { backgroundColor: 'var(--sel)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--sel)' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--text-dim)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 16px', minWidth: '2.5ch' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 2px' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text-2)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
    backgroundColor: 'var(--accent-soft)', outline: 'none', color: 'inherit',
  },
  '.cm-placeholder': { color: 'var(--text-dim)' },
});

// ---- Live-preview mode (Typora-style) ----------------------------------
// Conceal inline markdown markers (**, *, `, ~~) on every line EXCEPT the one
// the caret is on, so prose reads as rendered while the line you're editing
// shows its raw syntax. The emphasis styling itself comes from mdHighlight.
const CONCEAL_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);
const hideMark = Decoration.replace({});

function buildConceal(view) {
  const sel = view.state.selection.main;
  const curFrom = view.state.doc.lineAt(sel.from).from;
  const curTo = view.state.doc.lineAt(sel.to).to;
  const marks = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter(node) {
        if (!CONCEAL_MARKS.has(node.name) || node.from === node.to) return;
        if (node.to >= curFrom && node.from <= curTo) return; // reveal the caret line
        marks.push([node.from, node.to]);
      },
    });
  }
  marks.sort((a, b) => a[0] - b[0]);
  const builder = new RangeSetBuilder();
  let last = -1;
  for (const [f, tt] of marks) { if (f < last) continue; builder.add(f, tt, hideMark); last = tt; }
  return builder.finish();
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = buildConceal(view); }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = buildConceal(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

// Build the textarea-shaped facade over a live EditorView.
export function createEditor(opts) {
  const {
    parent, doc = '', dark = true, placeholder = '',
    onDocChange, onSelectionChange, onScroll, keymap: appKeys = [],
  } = opts;

  const themeCompartment = new Compartment();
  const liveCompartment = new Compartment(); // holds the live-preview plugin (off by default)
  let cachedDoc = doc; // avoid O(n) doc.toString() on every read; refreshed on change

  const updateListener = EditorView.updateListener.of((u) => {
    if (u.docChanged) { cachedDoc = u.state.doc.toString(); onDocChange && onDocChange(); }
    if (u.selectionSet || u.docChanged) onSelectionChange && onSelectionChange();
  });

  const state = EditorState.create({
    doc,
    extensions: [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      foldGutter(),
      EditorView.lineWrapping,
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(mdHighlight),
      placeholder ? cmPlaceholder(placeholder) : [],
      // App keymap first so Tab / Enter-list-continuation win over defaults;
      // returning false falls through to the default behaviour.
      keymap.of([...appKeys, ...defaultKeymap, ...historyKeymap, ...foldKeymap]),
      baseTheme,
      themeCompartment.of(EditorView.theme({}, { dark })),
      liveCompartment.of([]),
      updateListener,
      EditorView.domEventHandlers({ scroll: () => { onScroll && onScroll(); return false; } }),
    ],
  });

  const view = new EditorView({ state, parent });

  return {
    view,

    get value() { return cachedDoc; },
    set value(v) {
      // Match <textarea>.value = …: replace the whole doc and drop the caret at
      // the end (callers that want a specific caret set it right after).
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v }, selection: { anchor: v.length } });
    },

    get selectionStart() { return view.state.selection.main.from; },
    get selectionEnd() { return view.state.selection.main.to; },

    // Mirrors <textarea>.setRangeText(text, from, to, 'end'): replace the range
    // and (for 'end') drop the caret just after the inserted text.
    setRangeText(text, from, to, mode) {
      const spec = { changes: { from, to, insert: text } };
      if (mode === 'end') spec.selection = { anchor: from + text.length };
      view.dispatch(spec);
    },

    setSelectionRange(a, b) {
      const len = view.state.doc.length;
      const anchor = Math.max(0, Math.min(a, len));
      const head = Math.max(0, Math.min(b == null ? a : b, len));
      view.dispatch({ selection: { anchor, head }, scrollIntoView: true });
    },

    focus() { view.focus(); },
    blur() { view.contentDOM.blur(); },

    get scrollTop() { return view.scrollDOM.scrollTop; },
    set scrollTop(v) { view.scrollDOM.scrollTop = v; },
    get scrollHeight() { return view.scrollDOM.scrollHeight; },
    get clientHeight() { return view.scrollDOM.clientHeight; },

    // Swap the CodeMirror light/dark hint when the app theme changes (colours are
    // CSS vars and switch on their own; this only flips CM's internal assumptions).
    reconfigureTheme(isDark) {
      view.dispatch({ effects: themeCompartment.reconfigure(EditorView.theme({}, { dark: isDark })) });
    },

    // Toggle Typora-style live preview (conceal inline markers off the caret line).
    setLiveMode(on) {
      view.dispatch({ effects: liveCompartment.reconfigure(on ? livePreviewPlugin : []) });
    },
  };
}
