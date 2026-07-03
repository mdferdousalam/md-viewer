/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
'use strict';

// A CodeMirror 6 editor wrapped in a *textarea-shaped facade* so the rest of the
// renderer (and the control-API/MCP `edit` ops) can keep using the same idioms
// they used with the old <textarea>: `.value` get/set, `selectionStart/End`,
// `setRangeText`, `setSelectionRange`, `focus`, and `scrollTop/scrollHeight/
// clientHeight`. This keeps the migration surgical — no main/preload/MCP changes.

import { EditorState, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor, placeholder as cmPlaceholder,
  ViewPlugin, Decoration,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
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
    fontFamily: 'var(--font-mono)', fontSize: 'var(--editor-size, 14.5px)', lineHeight: '1.75', overflow: 'auto',
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
  // Autocomplete popup, themed with the app tokens.
  '.cm-tooltip.cm-tooltip-autocomplete': {
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    background: 'var(--surface)', boxShadow: 'var(--shadow)', overflow: 'hidden',
  },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'var(--font-ui)', fontSize: '13px', maxHeight: '16em' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px', color: 'var(--text-2)' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { background: 'var(--accent-soft)', color: 'var(--text)' },
  '.cm-completionLabel': { color: 'inherit' },
  '.cm-completionDetail': { color: 'var(--text-dim)', fontStyle: 'normal', marginLeft: '8px', fontSize: '12px' },
});

// ---- Live-preview mode (Typora-style) ----------------------------------
// Conceal inline markdown markers (**, *, `, ~~) on every line EXCEPT the one
// the caret is on, so prose reads as rendered while the line you're editing
// shows its raw syntax. The emphasis styling itself comes from mdHighlight.
const CONCEAL_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'CodeMark']);
const HEADING_NODE = /^ATXHeading(\d)$/;
const hideMark = Decoration.replace({});
const headingLine = {};
for (let i = 1; i <= 6; i++) headingLine[i] = Decoration.line({ class: `cm-live-h${i}` });

function buildLive(view) {
  const sel = view.state.selection.main;
  const curFrom = view.state.doc.lineAt(sel.from).from;
  const curTo = view.state.doc.lineAt(sel.to).to;
  const onCaretLine = (f, tt) => tt >= curFrom && f <= curTo;
  const decos = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from, to,
      enter(node) {
        const hm = HEADING_NODE.exec(node.name);
        if (hm) {
          // Size the whole heading line (even while editing it).
          decos.push(headingLine[hm[1]].range(view.state.doc.lineAt(node.from).from));
          return;
        }
        if (node.name === 'HeaderMark') {
          if (onCaretLine(node.from, node.to)) return;
          const after = view.state.doc.sliceString(node.to, node.to + 1);
          decos.push(hideMark.range(node.from, node.to + (after === ' ' ? 1 : 0)));
          return;
        }
        if (CONCEAL_MARKS.has(node.name) && node.from !== node.to && !onCaretLine(node.from, node.to)) {
          decos.push(hideMark.range(node.from, node.to));
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) { this.decorations = buildLive(view); }
    update(u) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) this.decorations = buildLive(u.view);
    }
  },
  { decorations: (v) => v.decorations }
);

// ---- Autocomplete --------------------------------------------------------
// Completion sources are data-driven: the renderer passes plain providers
// (a workspace-note list getter and the emoji map) so all CM6 autocomplete
// wiring stays here and the renderer stays framework-agnostic.

// `[[` → workspace note names. Accepting a note inserts its stem and the
// closing `]]` (unless the user already typed it), leaving the caret after.
function wikiCompletionSource(getWikiTargets) {
  return (context) => {
    const before = context.matchBefore(/\[\[[^\]\n|#]*$/);
    if (!before) return null;
    const targets = getWikiTargets ? getWikiTargets() : [];
    if (!targets.length) return null;
    const options = targets.map((t) => ({
      label: t.stem || t.name,
      detail: t.relPath && t.relPath !== (t.stem || t.name) + '.md' ? t.relPath : undefined,
      type: 'class',
      apply: (view, completion, from, to) => {
        const after = view.state.sliceDoc(to, to + 2);
        const insert = completion.label + (after === ']]' ? '' : ']]');
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      },
    }));
    return { from: before.from + 2, options, validFor: /^[^\]\n|#]*$/ };
  };
}

// `:shortcode` → emoji. Requires at least one character after the colon so it
// doesn't fire on every `word:` in prose.
function emojiCompletionSource(emojiMap) {
  const keys = Object.keys(emojiMap || {});
  return (context) => {
    const before = context.matchBefore(/:[a-z0-9_+-]+$/);
    if (!before) return null;
    const typed = before.text.slice(1).toLowerCase();
    const options = keys.filter((k) => k.includes(typed)).slice(0, 60).map((k) => ({
      label: `:${k}:`, detail: emojiMap[k], type: 'text',
    }));
    if (!options.length) return null;
    return { from: before.from, options, validFor: /^:[a-z0-9_+-]*$/ };
  };
}

// Build the textarea-shaped facade over a live EditorView.
export function createEditor(opts) {
  const {
    parent, doc = '', dark = true, placeholder = '',
    onDocChange, onSelectionChange, onScroll, keymap: appKeys = [],
    getWikiTargets, emojiMap,
  } = opts;

  // Only enable the sources that have a provider, so autocomplete stays silent
  // when there's no workspace / emoji map.
  const completionSources = [];
  if (getWikiTargets) completionSources.push(wikiCompletionSource(getWikiTargets));
  if (emojiMap) completionSources.push(emojiCompletionSource(emojiMap));
  const autocompleteExt = completionSources.length
    ? [autocompletion({ override: completionSources, activateOnTyping: true, icons: false })]
    : [];

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
      // Let the OS spellchecker underline prose; suggestions come from the
      // native context menu wired in the main process.
      EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'off', autocorrect: 'off' }),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(mdHighlight),
      placeholder ? cmPlaceholder(placeholder) : [],
      autocompleteExt,
      // Completion keys first so Enter/↑/↓ drive an open popup; each returns
      // false when no popup is active and falls through to the app keys (e.g.
      // Enter → list continuation). App keys then win over CM defaults.
      keymap.of([...completionKeymap, ...appKeys, ...defaultKeymap, ...historyKeymap, ...foldKeymap]),
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
