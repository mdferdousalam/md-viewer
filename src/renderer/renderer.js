/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
'use strict';

import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';
import { createEditor } from './editor/cm-editor.js';

// ============================================================
// Markdown pipeline
// ============================================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// $$ ... $$ (block) and $ ... $ (inline) via KaTeX.
const mathExtension = {
  extensions: [
    {
      name: 'blockMath',
      level: 'block',
      start(src) { const i = src.indexOf('$$'); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (m) return { type: 'blockMath', raw: m[0], text: m[1].trim() };
      },
      renderer(token) {
        try {
          return katex.renderToString(token.text, { displayMode: true, throwOnError: false, output: 'html' });
        } catch (e) {
          return `<pre class="md-error">${escapeHtml(token.text)}</pre>`;
        }
      },
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/.exec(src);
        if (m) return { type: 'inlineMath', raw: m[0], text: m[1] };
      },
      renderer(token) {
        try {
          return katex.renderToString(token.text, { throwOnError: false, output: 'html' });
        } catch (e) {
          return `<code class="md-error">${escapeHtml(token.text)}</code>`;
        }
      },
    },
  ],
};

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang === 'mermaid') return escapeHtml(code); // rendered later
      if (lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang }).value; } catch (_) {}
      }
      try { return hljs.highlightAuto(code).value; } catch (_) { return escapeHtml(code); }
    },
  }),
  gfmHeadingId(),
  mathExtension,
  { gfm: true, breaks: false }
);

function renderMarkdown(text) {
  const raw = marked.parse(text || '');
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: ['target', 'rel', 'align', 'aria-hidden', 'style'],
    ADD_TAGS: ['input', 'svg', 'path', 'g', 'line', 'rect', 'circle', 'text', 'span'],
  });
}

// Mermaid is initialised lazily and re-themed when the theme changes.
let mermaidReady = false;
function initMermaid(theme) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : theme === 'sepia' ? 'neutral' : 'default',
    fontFamily: 'var(--font-ui)',
  });
  mermaidReady = true;
}

let mermaidSeq = 0;
async function renderMermaid() {
  const blocks = preview.querySelectorAll('pre code.language-mermaid');
  if (!blocks.length) return;
  const seq = ++mermaidSeq;
  for (const el of blocks) {
    const src = el.textContent;
    const pre = el.closest('pre');
    try {
      const { svg } = await mermaid.render(`mmd-${seq}-${Math.floor(performance.now())}-${Math.random().toString(36).slice(2)}`, src);
      if (seq !== mermaidSeq) return; // superseded by a newer render
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.innerHTML = svg;
      pre.replaceWith(div);
    } catch (e) {
      if (pre) pre.classList.add('md-error');
    }
  }
}

// ============================================================
// State + DOM
// ============================================================

const state = { filePath: null, savedContent: '', viewMode: 'split', theme: 'dark', zen: false, outlineOpen: false };

const $ = (id) => document.getElementById(id);
const app = document.querySelector('.app');
// CodeMirror 6 editor behind a textarea-shaped facade (see editor/cm-editor.js).
// The keymap/callbacks below reference functions declared later in this module;
// they're hoisted, and only *invoked* after init, so this wiring is safe.
const editor = createEditor({
  parent: $('editor'),
  doc: '',
  dark: true,
  placeholder: 'Start writing Markdown, or press ⌘O to open a file…',
  onDocChange: scheduleRender,
  onSelectionChange: updateCursor,
  onScroll: onEditorScroll,
  keymap: [
    { key: 'Tab', run: () => { surround('  ', '', ''); return true; } },
    { key: 'Shift-Tab', run: () => { outdent(); return true; } },
    { key: 'Enter', run: () => continueList() },
  ],
});
const preview = $('preview');
const workspace = $('workspace');
const editorPane = $('editorPane');
const divider = $('divider');
const fileNameEl = $('fileName');
const dirtyDot = $('dirtyDot');
const wordCountEl = $('wordCount');
const charCountEl = $('charCount');
const readTimeEl = $('readTime');
const cursorPosEl = $('cursorPos');
const outlineEl = $('outline');
const outlineList = $('outlineList');
const themeToggle = $('themeToggle');

// ============================================================
// Render loop
// ============================================================

let scheduled = false;
function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    updatePreview();
    updateStatus();
    buildOutline();
    reportDirty();
    emitChanged();
  });
}

// Notify any control-API listeners that the document changed (debounced so a
// burst of keystrokes yields one event). No-op unless the API server is on.
let evtTimer;
function emitChanged() {
  clearTimeout(evtTimer);
  evtTimer = setTimeout(() => {
    window.api.emitEvent?.('changed', { filePath: state.filePath, dirty: isDirty() });
  }, 400);
}

function updatePreview() {
  preview.innerHTML = renderMarkdown(editor.value);
  preview.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  wireCheckboxes();
  renderMermaid();
}

function isDirty() { return editor.value !== state.savedContent; }

function reportDirty() {
  const d = isDirty();
  dirtyDot.hidden = !d;
  window.api.reportDirty(d);
  document.title = `${d ? '• ' : ''}${baseName(state.filePath) || 'Untitled'} — Markdown Viewer`;
}

function baseName(p) { return p ? p.split(/[\\/]/).pop() : null; }

function updateStatus() {
  const text = editor.value;
  const words = (text.trim().match(/\S+/g) || []).length;
  wordCountEl.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  charCountEl.textContent = `${text.length} chars`;
  const mins = Math.max(words ? 1 : 0, Math.round(words / 200));
  readTimeEl.textContent = `${mins} min read`;
  fileNameEl.textContent = baseName(state.filePath) || 'Untitled';
  updateCursor();
}

function updateCursor() {
  const pos = editor.selectionStart;
  const before = editor.value.slice(0, pos);
  const line = before.split('\n').length;
  const col = pos - before.lastIndexOf('\n');
  cursorPosEl.textContent = `Ln ${line}, Col ${col}`;
}

// ============================================================
// Outline
// ============================================================

function buildOutline() {
  const heads = preview.querySelectorAll('h1, h2, h3, h4, h5, h6');
  outlineList.innerHTML = '';
  if (!heads.length) {
    outlineList.innerHTML = '<div class="outline-empty">No headings yet</div>';
    return;
  }
  heads.forEach((h, i) => {
    if (!h.id) h.id = `h-${i}`;
    const item = document.createElement('button');
    item.className = `outline-item lvl-${h.tagName[1]}`;
    item.textContent = h.textContent;
    item.dataset.target = h.id;
    item.addEventListener('click', () => {
      const t = preview.querySelector(`#${CSS.escape(h.id)}`);
      if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    outlineList.appendChild(item);
  });
}

function updateOutlineActive() {
  if (!state.outlineOpen) return;
  const heads = [...preview.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  let active = null;
  for (const h of heads) {
    if (h.getBoundingClientRect().top - preview.getBoundingClientRect().top < 80) active = h.id;
    else break;
  }
  outlineList.querySelectorAll('.outline-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.target === active);
  });
}

function toggleOutline(force) {
  state.outlineOpen = force !== undefined ? force : !state.outlineOpen;
  outlineEl.hidden = !state.outlineOpen;
  document.querySelector('[data-action="outline"]').classList.toggle('active', state.outlineOpen);
  if (state.outlineOpen) updateOutlineActive();
}

// ============================================================
// Live task-list checkboxes (write back to source)
// ============================================================

function wireCheckboxes() {
  const boxes = preview.querySelectorAll('li.task-list-item input[type="checkbox"]');
  let n = 0;
  boxes.forEach((cb) => {
    cb.disabled = false;
    const idx = n++;
    cb.addEventListener('change', () => toggleTaskInSource(idx, cb.checked));
  });
}

function toggleTaskInSource(index, checked) {
  const lines = editor.value.split('\n');
  let count = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]/);
    if (m) {
      count++;
      if (count === index) {
        lines[i] = lines[i].replace(/\[([ xX])\]/, checked ? '[x]' : '[ ]');
        break;
      }
    }
  }
  const pos = editor.selectionStart;
  editor.value = lines.join('\n');
  editor.setSelectionRange(pos, pos);
  scheduleRender();
}

// ============================================================
// Themes
// ============================================================

const THEMES = ['dark', 'light', 'sepia'];
function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.querySelector('use').setAttribute('href', theme === 'dark' ? '#i-moon' : '#i-sun');
  editor.reconfigureTheme(theme === 'dark');
  try { localStorage.setItem('mdviewer.theme', theme); } catch (_) {}
  initMermaid(theme);
  scheduleRender();
}
function cycleTheme() {
  setTheme(THEMES[(THEMES.indexOf(state.theme) + 1) % THEMES.length]);
}

// ============================================================
// View mode + zen
// ============================================================

function setViewMode(mode) {
  state.viewMode = mode;
  workspace.className = `workspace view-${mode}`;
  document.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === mode));
  if (mode !== 'split') editorPane.style.flexBasis = '';
}

function toggleZen(force) {
  state.zen = force !== undefined ? force : !state.zen;
  app.classList.toggle('zen', state.zen);
}

// ============================================================
// File operations
// ============================================================

function loadContent(filePath, content) {
  editor.value = content;
  state.filePath = filePath;
  state.savedContent = content;
  window.api.setWatchedFile?.(filePath);
  window.api.emitEvent?.('opened', { filePath });
  scheduleRender();
  editor.focus();
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
}

// A program/agent (or another editor) rewrote the open file on disk.
async function onExternalChange({ filePath, content }) {
  if (filePath !== state.filePath) return;      // stale watcher for a closed file
  if (content === state.savedContent) return;   // nothing new (incl. our own save)
  if (!isDirty()) {
    // Reload silently, keeping the caret/scroll roughly where they were.
    const pos = Math.min(editor.selectionStart, content.length);
    const top = editor.scrollTop;
    editor.value = content;
    state.savedContent = content;
    scheduleRender();
    editor.setSelectionRange(pos, pos);
    editor.scrollTop = top;
    flash('Reloaded — file changed on disk');
    return;
  }
  // Unsaved edits + disk changed: let the user decide, never clobber silently.
  if (await window.api.confirmReload()) {
    editor.value = content;
    state.savedContent = content;
    scheduleRender();
    flash('Reloaded from disk');
  }
}

async function maybeConfirmDiscard() {
  if (!isDirty()) return true;
  const choice = await window.api.confirmDiscard();
  if (choice === 'cancel') return false;
  if (choice === 'save') return await doSave();
  return true;
}

async function doNew() { if (await maybeConfirmDiscard()) loadContent(null, ''); }
async function doOpen() { if (await maybeConfirmDiscard()) await window.api.openDialog(); }

async function doSave(forceDialog = false) {
  const res = await window.api.save({ filePath: state.filePath, content: editor.value, forceDialog });
  if (!res || res.error) return false;
  state.filePath = res.filePath;
  state.savedContent = editor.value;
  window.api.setWatchedFile?.(res.filePath);
  window.api.emitEvent?.('saved', { filePath: res.filePath });
  scheduleRender();
  return true;
}

async function doExportHtml() {
  await window.api.exportHtml({
    html: buildStandaloneHtml(),
    title: (baseName(state.filePath) || 'export').replace(/\.[^.]+$/, ''),
  });
}

// Collect every loaded stylesheet's rules so the export is fully self-contained
// (markdown typography + KaTeX + highlight.js + Mermaid inline styles included).
function collectCss() {
  let css = '';
  for (const sheet of document.styleSheets) {
    try { for (const rule of sheet.cssRules) css += rule.cssText + '\n'; }
    catch (_) { /* opaque/cross-origin sheet — skip */ }
  }
  return css;
}

// Neutralise the app-shell layout (fixed height, hidden overflow) so the export
// is a normal, scrollable, printable document.
const EXPORT_RESET = `
html,body{height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;position:static!important}
body.markdown-body{display:block!important;max-width:840px;margin:2rem auto;padding:0 1.25rem;background:var(--bg)!important;color:var(--text)!important}
`;

// Built from the live preview DOM so rendered diagrams + math are baked in.
// Always light-themed for readable print/PDF regardless of the app theme.
function buildStandaloneHtml() {
  const title = (baseName(state.filePath) || 'Markdown Export').replace(/\.[^.]+$/, '');
  return `<!DOCTYPE html><html data-theme="light"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>${collectCss()}\n${EXPORT_RESET}</style></head>
<body class="markdown-body">${preview.innerHTML}</body></html>`;
}

async function copyHtml() {
  try { await navigator.clipboard.writeText(preview.innerHTML); flash('HTML copied to clipboard'); }
  catch (_) { flash('Copy failed'); }
}

async function exportPdf() {
  const res = await window.api.exportPdf({
    html: buildStandaloneHtml(),
    title: (baseName(state.filePath) || 'export').replace(/\.[^.]+$/, ''),
  });
  if (res && res.error) flash('PDF export failed');
  else if (res) flash('PDF exported');
}

// ============================================================
// Programmatic API — ops the main process can request over the bridge
// (headless CLI export today; the local control API in a later phase).
// ============================================================

// Extract the heading structure straight from the source (fence-aware) so
// agents get a stable outline without depending on the rendered DOM.
function outlineFromSource() {
  const lines = editor.value.split('\n');
  const out = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m) out.push({ level: m[1].length, text: m[2].trim(), line: i });
  }
  return out;
}

function findHeadingLine(lines, heading) {
  const target = String(heading).trim().toLowerCase();
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m && m[2].trim().toLowerCase() === target) return { index: i, level: m[1].length };
  }
  return null;
}

// First line at or above `level` after startIdx = end of that section's body.
function sectionEnd(lines, startIdx, level) {
  let inFence = false;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^```/.test(lines[i].trim())) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) return i;
  }
  return lines.length;
}

function insertAtHeading(heading, md, position) {
  const lines = editor.value.split('\n');
  const h = findHeadingLine(lines, heading);
  if (!h) throw new Error(`heading not found: ${heading}`);
  lines.splice(position === 'before' ? h.index : h.index + 1, 0, md);
  editor.value = lines.join('\n');
}

// Replace a section's body (everything under the heading up to the next
// same-or-higher heading), keeping the heading line itself.
function replaceSection(heading, md) {
  const lines = editor.value.split('\n');
  const h = findHeadingLine(lines, heading);
  if (!h) throw new Error(`heading not found: ${heading}`);
  const end = sectionEnd(lines, h.index, h.level);
  editor.value = lines.slice(0, h.index + 1).concat('', md, '', lines.slice(end)).join('\n');
}

const wordCount = (t) => (t.trim().match(/\S+/g) || []).length;

const API_OPS = {
  // Render given markdown fully (incl. async Mermaid) -> standalone HTML.
  renderForExport: async (content) => {
    editor.value = content;
    preview.innerHTML = renderMarkdown(editor.value);
    preview.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    await renderMermaid();
    return buildStandaloneHtml();
  },

  // Standalone HTML for the CURRENT document (used by /export).
  getExportHtml: async () => {
    preview.innerHTML = renderMarkdown(editor.value);
    preview.querySelectorAll('a[href]').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    });
    await renderMermaid();
    return buildStandaloneHtml();
  },

  getDocument: async () => ({
    filePath: state.filePath,
    content: editor.value,
    outline: outlineFromSource(),
    wordCount: wordCount(editor.value),
    dirty: isDirty(),
    viewMode: state.viewMode,
    theme: state.theme,
  }),

  setContent: async ({ content }) => {
    editor.value = content;
    scheduleRender();
    return { ok: true, wordCount: wordCount(content) };
  },

  edit: async (body) => {
    switch (body.op) {
      case 'append': {
        const v = editor.value;
        editor.value = v + (v === '' || v.endsWith('\n') ? '' : '\n') + (body.markdown || '');
        break;
      }
      case 'insertAtHeading':
        insertAtHeading(body.heading, body.markdown || '', body.position || 'after');
        break;
      case 'replaceSection':
        replaceSection(body.heading, body.markdown || '');
        break;
      case 'applyFormat':
        applyFormat(body.name);
        break;
      case 'toggleTask':
        toggleTaskInSource(body.index | 0, !!body.checked);
        break;
      case 'findReplace': {
        const re = new RegExp(String(body.find).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), body.all ? 'g' : '');
        editor.value = editor.value.replace(re, body.replace != null ? body.replace : '');
        break;
      }
      default:
        throw new Error(`unknown edit op: ${body.op}`);
    }
    scheduleRender();
    return { ok: true };
  },

  setView: async ({ mode, theme, outline, zen } = {}) => {
    if (mode) setViewMode(mode);
    if (theme) setTheme(theme);
    if (outline !== undefined) toggleOutline(!!outline);
    if (zen !== undefined) toggleZen(!!zen);
    return { ok: true, viewMode: state.viewMode, theme: state.theme };
  },

  save: async ({ path } = {}) => {
    const target = path || state.filePath;
    if (!target) throw new Error('no file path; provide { "path": ... }');
    const res = await window.api.save({ filePath: target, content: editor.value, forceDialog: false });
    if (!res || res.error) throw new Error(res && res.error ? res.error : 'save failed');
    state.filePath = res.filePath;
    state.savedContent = editor.value;
    window.api.setWatchedFile?.(res.filePath);
    scheduleRender();
    return { filePath: res.filePath };
  },
};

if (window.api.onApiRequest) {
  window.api.onApiRequest(async ({ id, op, args }) => {
    try {
      const fn = API_OPS[op];
      if (!fn) throw new Error(`unknown op: ${op}`);
      window.api.sendApiResponse({ id, result: await fn(args) });
    } catch (err) {
      window.api.sendApiResponse({ id, error: err.message });
    }
  });
}

// ============================================================
// Formatting
// ============================================================

function getSel() { return editor.value.slice(editor.selectionStart, editor.selectionEnd); }

function surround(before, after = before, placeholder = '') {
  const s = editor.selectionStart, e = editor.selectionEnd, v = editor.value;
  const sel = v.slice(s, e) || placeholder;
  editor.setRangeText(before + sel + after, s, e, 'end');
  if (!v.slice(s, e)) editor.setSelectionRange(s + before.length, s + before.length + placeholder.length);
  editor.focus();
  scheduleRender();
}

function prefixLines(prefix, { numbered = false } = {}) {
  const s = editor.selectionStart, e = editor.selectionEnd, v = editor.value;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  const block = v.slice(ls, e);
  const out = block.split('\n').map((l, i) => (numbered ? `${i + 1}. ` : prefix) + l).join('\n');
  editor.setRangeText(out, ls, e, 'end');
  editor.focus();
  scheduleRender();
}

function insertBlock(text) {
  const s = editor.selectionStart, v = editor.value;
  const nl = s > 0 && v[s - 1] !== '\n' ? '\n' : '';
  editor.setRangeText(nl + text, s, editor.selectionEnd, 'end');
  editor.focus();
  scheduleRender();
}

const FORMATTERS = {
  bold: () => surround('**', '**', 'bold text'),
  italic: () => surround('*', '*', 'italic text'),
  strike: () => surround('~~', '~~', 'strikethrough'),
  code: () => surround('`', '`', 'code'),
  h1: () => prefixLines('# '),
  h2: () => prefixLines('## '),
  h3: () => prefixLines('### '),
  quote: () => prefixLines('> '),
  ul: () => prefixLines('- '),
  ol: () => prefixLines('', { numbered: true }),
  task: () => prefixLines('- [ ] '),
  hr: () => insertBlock('\n---\n\n'),
  codeblock: () => insertBlock('```\n' + (getSel() || 'code') + '\n```\n'),
  link: () => surround('[', '](https://)', getSel() || 'link text'),
  image: () => insertBlock('![alt text](https://)'),
  table: () => insertBlock('\n| Column A | Column B |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n\n'),
};
function applyFormat(name) { const f = FORMATTERS[name]; if (f) f(); }

// ============================================================
// Editor UX
// ============================================================

// Tab / Shift-Tab / Enter-list-continuation are wired as CodeMirror keymap
// entries (see the createEditor call above); these helpers do the work.
function outdent() {
  const s = editor.selectionStart, v = editor.value;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  if (v.slice(ls, ls + 2) === '  ') { editor.setRangeText('', ls, ls + 2, 'end'); scheduleRender(); }
}

function continueList() {
  const s = editor.selectionStart;
  if (s !== editor.selectionEnd) return false;
  const v = editor.value;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  const line = v.slice(ls, s);
  const m = line.match(/^(\s*)(-|\*|\+|\d+\.)\s(\[[ xX]\]\s)?/);
  if (!m) return false;
  const [, indent, marker, task] = m;
  if (line.trim() === (marker + (task ? ' ' + task.trim() : '')).trim()) {
    editor.setRangeText('', ls, s, 'end'); scheduleRender(); return true;
  }
  const next = /^\d+\.$/.test(marker) ? `${parseInt(marker, 10) + 1}.` : marker;
  editor.setRangeText(`\n${indent}${next} ${task ? '[ ] ' : ''}`, s, s, 'end');
  scheduleRender();
  return true;
}

// Scroll sync (editor → preview), invoked via the editor facade's onScroll.
let syncing = false;
function onEditorScroll() {
  if (syncing || state.viewMode !== 'split') return;
  syncing = true;
  const r = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
  preview.scrollTop = r * (preview.scrollHeight - preview.clientHeight);
  requestAnimationFrame(() => (syncing = false));
}
preview.addEventListener('scroll', () => { updateOutlineActive(); });

// Divider drag
let dragging = false;
divider.addEventListener('mousedown', (e) => {
  if (state.viewMode !== 'split') return;
  dragging = true; e.preventDefault();
  divider.classList.add('dragging'); document.body.style.cursor = 'col-resize';
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const rect = workspace.getBoundingClientRect();
  const offset = state.outlineOpen ? outlineEl.offsetWidth : 0;
  const pct = ((e.clientX - rect.left - offset) / (rect.width - offset)) * 100;
  editorPane.style.flexBasis = `${Math.min(85, Math.max(15, pct))}%`;
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false; divider.classList.remove('dragging'); document.body.style.cursor = '';
});

// Drag & drop to open
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));
window.addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const fp = window.electronFilePath?.(file) || file.path;
  if (!(await maybeConfirmDiscard())) return;
  if (fp) {
    const res = await window.api.readFile(fp);
    if (res && !res.error) loadContent(res.filePath, res.content);
  } else {
    loadContent(null, await file.text());
  }
});

// ============================================================
// Find & replace
// ============================================================

const findBar = $('findBar');
const findInput = $('findInput');
const replaceInput = $('replaceInput');
const findCount = $('findCount');
let matches = [];
let matchIdx = -1;

function openFind() {
  findBar.hidden = false;
  findInput.value = getSel() || findInput.value;
  findInput.focus();
  findInput.select();
  runFind();
}
function closeFind() { findBar.hidden = true; editor.focus(); }

function runFind() {
  const q = findInput.value;
  matches = [];
  if (q) {
    const hay = editor.value.toLowerCase();
    const needle = q.toLowerCase();
    let i = hay.indexOf(needle);
    while (i !== -1) { matches.push(i); i = hay.indexOf(needle, i + Math.max(1, needle.length)); }
  }
  matchIdx = matches.length ? 0 : -1;
  selectMatch();
}

function selectMatch() {
  findCount.textContent = matches.length ? `${matchIdx + 1}/${matches.length}` : '0/0';
  if (matchIdx < 0) return;
  const start = matches[matchIdx];
  // Move the editor selection to the match (scrolls it into view) without
  // stealing focus from the find input, so typing/Enter keep working.
  editor.setSelectionRange(start, start + findInput.value.length);
}

function findNext(dir = 1) {
  if (!matches.length) return;
  matchIdx = (matchIdx + dir + matches.length) % matches.length;
  selectMatch();
}

function replaceOne() {
  if (matchIdx < 0) return;
  const start = matches[matchIdx];
  const len = findInput.value.length;
  editor.setRangeText(replaceInput.value, start, start + len, 'end');
  scheduleRender();
  runFind();
}
function replaceAll() {
  if (!findInput.value) return;
  const re = new RegExp(findInput.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  editor.value = editor.value.replace(re, replaceInput.value);
  scheduleRender();
  runFind();
}

findInput.addEventListener('input', runFind);
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') closeFind();
});
replaceInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFind(); });
$('findNext').addEventListener('click', () => findNext(1));
$('findPrev').addEventListener('click', () => findNext(-1));
$('findClose').addEventListener('click', closeFind);
$('replaceOne').addEventListener('click', replaceOne);
$('replaceAll').addEventListener('click', replaceAll);

// ============================================================
// Command palette
// ============================================================

const COMMANDS = [
  { id: 'new', label: 'New File', key: '⌘N', icon: 'i-new', run: doNew },
  { id: 'open', label: 'Open File…', key: '⌘O', icon: 'i-open', run: doOpen },
  { id: 'save', label: 'Save', key: '⌘S', icon: 'i-save', run: () => doSave(false) },
  { id: 'saveas', label: 'Save As…', key: '⌘⇧S', icon: 'i-save', run: () => doSave(true) },
  { id: 'exporthtml', label: 'Export as HTML…', icon: 'i-code', run: doExportHtml },
  { id: 'exportpdf', label: 'Export as PDF…', icon: 'i-save', run: exportPdf },
  { id: 'copyhtml', label: 'Copy as HTML', icon: 'i-code', run: copyHtml },
  { id: 'find', label: 'Find & Replace', key: '⌘F', icon: 'i-search', run: openFind },
  { id: 'outline', label: 'Toggle Outline', icon: 'i-outline', run: () => toggleOutline() },
  { id: 've', label: 'View: Editor only', key: '⌘1', icon: 'i-edit', run: () => setViewMode('editor') },
  { id: 'vs', label: 'View: Split', key: '⌘2', icon: 'i-split', run: () => setViewMode('split') },
  { id: 'vp', label: 'View: Preview only', key: '⌘3', icon: 'i-eye', run: () => setViewMode('preview') },
  { id: 'zen', label: 'Toggle Focus Mode', key: '⌘⇧F', icon: 'i-zen', run: () => toggleZen() },
  { id: 'theme', label: 'Cycle Theme (Dark / Light / Sepia)', key: '⌘⇧L', icon: 'i-sun', run: cycleTheme },
  { id: 'help', label: 'Keyboard Shortcuts', key: '?', icon: 'i-help', run: () => toggleHelp(true) },
];

const paletteOverlay = $('paletteOverlay');
const paletteInput = $('paletteInput');
const paletteList = $('paletteList');
let paletteSel = 0;
let paletteFiltered = [];

function openPalette() {
  paletteOverlay.hidden = false;
  paletteInput.value = '';
  renderPalette('');
  paletteInput.focus();
}
function closePalette() { paletteOverlay.hidden = true; editor.focus(); }

function renderPalette(q) {
  const query = q.toLowerCase();
  paletteFiltered = COMMANDS.filter((c) => c.label.toLowerCase().includes(query));
  paletteSel = 0;
  paletteList.innerHTML = '';
  if (!paletteFiltered.length) { paletteList.innerHTML = '<div class="palette-empty">No matching commands</div>'; return; }
  paletteFiltered.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'palette-item' + (i === 0 ? ' active' : '');
    li.innerHTML = `<svg class="ic"><use href="#${c.icon}"/></svg><span class="palette-label"></span>${c.key ? `<span class="palette-key">${c.key}</span>` : ''}`;
    li.querySelector('.palette-label').textContent = c.label;
    li.addEventListener('click', () => runPalette(i));
    li.addEventListener('mousemove', () => setPaletteSel(i));
    paletteList.appendChild(li);
  });
}
function setPaletteSel(i) {
  paletteSel = i;
  [...paletteList.children].forEach((el, idx) => el.classList.toggle('active', idx === i));
}
function runPalette(i) { const c = paletteFiltered[i]; closePalette(); if (c) setTimeout(c.run, 0); }

paletteInput.addEventListener('input', () => renderPalette(paletteInput.value));
paletteInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteSel(Math.min(paletteSel + 1, paletteFiltered.length - 1)); scrollPalette(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteSel(Math.max(paletteSel - 1, 0)); scrollPalette(); }
  else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteSel); }
  else if (e.key === 'Escape') closePalette();
});
function scrollPalette() { paletteList.children[paletteSel]?.scrollIntoView({ block: 'nearest' }); }
paletteOverlay.addEventListener('mousedown', (e) => { if (e.target === paletteOverlay) closePalette(); });

// ============================================================
// Shortcut help
// ============================================================

const helpOverlay = $('helpOverlay');
const SHORTCUTS = [
  ['New file', '⌘N'], ['Open', '⌘O'], ['Save', '⌘S'], ['Save As', '⌘⇧S'],
  ['Bold', '⌘B'], ['Italic', '⌘I'], ['Insert link', '⌘K'],
  ['Find & replace', '⌘F'], ['Command palette', '⌘⇧P'],
  ['Editor / Split / Preview', '⌘1 / ⌘2 / ⌘3'], ['Toggle outline', '⌘\\'],
  ['Focus mode', '⌘⇧F'], ['Cycle theme', '⌘⇧L'], ['Shortcuts', '?'],
];
function buildHelp() {
  $('helpGrid').innerHTML = SHORTCUTS.map(([l, k]) =>
    `<div class="help-row"><span></span><kbd>${k}</kbd></div>`).join('');
  [...$('helpGrid').querySelectorAll('.help-row span')].forEach((s, i) => (s.textContent = SHORTCUTS[i][0]));
}
function toggleHelp(force) {
  const show = force !== undefined ? force : helpOverlay.hidden;
  helpOverlay.hidden = !show;
}
helpOverlay.addEventListener('mousedown', (e) => { if (e.target === helpOverlay) toggleHelp(false); });

// ============================================================
// Toast
// ============================================================

let toastTimer;
function flash(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ============================================================
// Wiring
// ============================================================

$('toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.format) return applyFormat(btn.dataset.format);
  if (btn.dataset.view) return setViewMode(btn.dataset.view);
  switch (btn.dataset.action) {
    case 'new': return doNew();
    case 'open': return doOpen();
    case 'save': return doSave();
    case 'outline': return toggleOutline();
    case 'palette': return openPalette();
    case 'zen': return toggleZen();
    case 'theme': return cycleTheme();
    case 'help': return toggleHelp();
  }
});
document.querySelectorAll('[data-action="outline"]').forEach((b) => b.addEventListener('click', (e) => {
  if (e.currentTarget.closest('.outline-head')) toggleOutline(false);
}));
document.querySelectorAll('[data-action="help"]').forEach((b) => b.addEventListener('click', (e) => {
  if (e.currentTarget.closest('.help-head')) toggleHelp(false);
}));

// Editor input / selection changes are delivered via the facade's
// onDocChange (scheduleRender) and onSelectionChange (updateCursor) callbacks.

window.api.onFileOpened(({ filePath, content }) => loadContent(filePath, content));
window.api.onExternalChange(onExternalChange);
window.api.onMenuNew(doNew);
window.api.onMenuSave(() => doSave(false));
window.api.onMenuSaveAs(() => doSave(true));
window.api.onMenuExportHtml(doExportHtml);
window.api.onMenuFormat(applyFormat);
window.api.onMenuViewMode(setViewMode);
window.api.onMenuToggleTheme(cycleTheme);
window.api.onMenuFind(openFind);
window.api.onMenuPalette(openPalette);
window.api.onMenuOutline(() => toggleOutline());
window.api.onMenuZen(() => toggleZen());
window.api.onMenuExportPdf(exportPdf);

// Global keybindings
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  // ? opens help when not typing
  if (e.key === '?' && !mod && !isTyping(e.target)) { e.preventDefault(); toggleHelp(true); return; }
  if (e.key === 'Escape') {
    if (!paletteOverlay.hidden) return closePalette();
    if (!helpOverlay.hidden) return toggleHelp(false);
    if (!findBar.hidden) return closeFind();
    if (state.zen) return toggleZen(false);
  }
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); doSave(e.shiftKey); }
  else if (k === 'f' && e.shiftKey) { e.preventDefault(); toggleZen(); }
  else if (k === 'f') { e.preventDefault(); openFind(); }
  else if (k === 'p' && e.shiftKey) { e.preventDefault(); openPalette(); }
  else if (k === 'l' && e.shiftKey) { e.preventDefault(); cycleTheme(); }
  else if (k === '\\') { e.preventDefault(); toggleOutline(); }
  else if (k === '1') { e.preventDefault(); setViewMode('editor'); }
  else if (k === '2') { e.preventDefault(); setViewMode('split'); }
  else if (k === '3') { e.preventDefault(); setViewMode('preview'); }
});
function isTyping(el) {
  return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    || el.isContentEditable || (el.closest && el.closest('.cm-editor'))));
}

window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ============================================================
// Content constants
// ============================================================

const WELCOME = `# Welcome to Markdown Viewer

A fast, beautiful **Markdown editor** with live preview — for macOS, Windows, and Linux.

## What makes it great

- **Live split preview** with synced scrolling
- **Command palette** — press \`⌘⇧P\` to run any action
- **Document outline** — press \`⌘\\\` to jump between sections
- **Find & replace** with \`⌘F\`
- **Focus mode** with \`⌘⇧F\`, and three themes (\`⌘⇧L\`)

## Rich rendering

Inline math like $E = mc^2$ and display math:

$$\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}$$

Diagrams with Mermaid:

\`\`\`mermaid
graph LR
  A[Write] --> B{Preview}
  B -->|looks good| C[Save]
  B -->|tweak| A
\`\`\`

Code with syntax highlighting:

\`\`\`js
const greet = (name) => \`Hello, \${name}!\`;
console.log(greet("world"));
\`\`\`

## Interactive task lists

- [x] Open the app
- [x] Try the command palette
- [ ] Write something great

> Tip: click the checkboxes above — they update the source live.

| Feature        | Supported |
| -------------- | :-------: |
| Math (KaTeX)   |    ✅     |
| Diagrams       |    ✅     |
| Task lists     |    ✅     |

Happy writing! ✍️
`;

// ============================================================
// Init (runs last so the content constants above are defined)
// ============================================================

(function init() {
  let saved = 'dark';
  try { const t = localStorage.getItem('mdviewer.theme'); if (THEMES.includes(t)) saved = t; } catch (_) {}
  setTheme(saved);
  setViewMode('split');
  buildHelp();
  loadContent(null, WELCOME);
  state.savedContent = '';
  reportDirty();
})();
