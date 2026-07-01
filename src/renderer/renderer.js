'use strict';

import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import mermaid from 'mermaid';

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
const editor = $('editor');
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
  });
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
  scheduleRender();
  editor.focus();
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
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
  scheduleRender();
  return true;
}

async function doExportHtml() {
  await window.api.exportHtml({
    html: buildStandaloneHtml(),
    title: (baseName(state.filePath) || 'export').replace(/\.[^.]+$/, ''),
  });
}

function buildStandaloneHtml() {
  const title = (baseName(state.filePath) || 'Markdown Export').replace(/\.[^.]+$/, '');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title>
<style>${EXPORT_CSS}</style></head><body class="markdown-body">${renderMarkdown(editor.value)}</body></html>`;
}

async function copyHtml() {
  try { await navigator.clipboard.writeText(renderMarkdown(editor.value)); flash('HTML copied to clipboard'); }
  catch (_) { flash('Copy failed'); }
}

function exportPdf() { window.print(); }

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

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) outdent(); else surround('  ', '', '');
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && continueList()) e.preventDefault();
});

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

// Scroll sync
let syncing = false;
editor.addEventListener('scroll', () => {
  if (syncing || state.viewMode !== 'split') return;
  syncing = true;
  const r = editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
  preview.scrollTop = r * (preview.scrollHeight - preview.clientHeight);
  requestAnimationFrame(() => (syncing = false));
});
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
  editor.focus();
  editor.setSelectionRange(start, start + findInput.value.length);
  // keep the selection visible
  const before = editor.value.slice(0, start).split('\n').length;
  editor.blur(); editor.focus();
  editor.scrollTop = Math.max(0, (before - 5) * 24);
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

editor.addEventListener('input', scheduleRender);
editor.addEventListener('keyup', updateCursor);
editor.addEventListener('click', updateCursor);

window.api.onFileOpened(({ filePath, content }) => loadContent(filePath, content));
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
function isTyping(el) { return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT'); }

window.addEventListener('beforeunload', (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } });

// ============================================================
// Content constants
// ============================================================

const EXPORT_CSS = `
body{max-width:820px;margin:2rem auto;padding:0 1.25rem;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.7;color:#24292f}
pre{background:#f6f8fa;padding:1rem;border-radius:8px;overflow:auto}code{background:rgba(175,184,193,.2);padding:.2em .4em;border-radius:6px;font-size:85%}
pre code{background:none;padding:0}blockquote{border-left:4px solid #d0d7de;margin:0;padding:0 1rem;color:#57606a}
table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:.4rem .8rem}img{max-width:100%}h1,h2{border-bottom:1px solid #d0d7de;padding-bottom:.3em}a{color:#0969da}`;

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
