'use strict';

import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

// ---- Markdown pipeline --------------------------------------------------

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(code, { language: lang }).value;
        } catch (_) {
          /* fall through */
        }
      }
      try {
        return hljs.highlightAuto(code).value;
      } catch (_) {
        return code;
      }
    },
  }),
  gfmHeadingId(),
  { gfm: true, breaks: false }
);

function renderMarkdown(text) {
  const rawHtml = marked.parse(text || '');
  return DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target', 'rel'],
    ADD_TAGS: ['input'], // task-list checkboxes
  });
}

// ---- App state ----------------------------------------------------------

const state = {
  filePath: null,
  savedContent: '',
  viewMode: 'split',
  theme: 'dark',
};

// ---- DOM refs -----------------------------------------------------------

const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const workspace = document.getElementById('workspace');
const fileNameEl = document.getElementById('fileName');
const dirtyDot = document.getElementById('dirtyDot');
const cursorPosEl = document.getElementById('cursorPos');
const wordCountEl = document.getElementById('wordCount');
const charCountEl = document.getElementById('charCount');
const themeToggle = document.getElementById('themeToggle');
const divider = document.getElementById('divider');
const editorPane = document.getElementById('editorPane');

// ---- Rendering / status -------------------------------------------------

let renderScheduled = false;
function scheduleRender() {
  if (renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    updatePreview();
    updateStatus();
    reportDirty();
  });
}

function updatePreview() {
  preview.innerHTML = renderMarkdown(editor.value);
  // Ensure links open externally & are safe.
  preview.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  // Task-list checkboxes are read-only in preview.
  preview.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.disabled = true;
  });
}

function isDirty() {
  return editor.value !== state.savedContent;
}

function reportDirty() {
  const dirty = isDirty();
  dirtyDot.hidden = !dirty;
  window.api.reportDirty(dirty);
  document.title = `${dirty ? '• ' : ''}${baseName(state.filePath) || 'Untitled'} — Markdown Viewer`;
}

function baseName(p) {
  if (!p) return null;
  return p.split(/[\\/]/).pop();
}

function updateStatus() {
  const text = editor.value;
  const words = (text.trim().match(/\S+/g) || []).length;
  wordCountEl.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  charCountEl.textContent = `${text.length} chars`;
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

// ---- View mode / theme --------------------------------------------------

function setViewMode(mode) {
  state.viewMode = mode;
  workspace.className = `workspace view-${mode}`;
  document.querySelectorAll('.view-modes button').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === mode);
  });
  if (mode !== 'split') editorPane.style.flexBasis = '';
}

function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  themeToggle.innerHTML = theme === 'dark' ? '&#9789;' : '&#9788;';
  try {
    localStorage.setItem('mdviewer.theme', theme);
  } catch (_) {}
}

function toggleTheme() {
  setTheme(state.theme === 'dark' ? 'light' : 'dark');
}

// ---- File operations ----------------------------------------------------

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
  return true; // discard
}

async function doNew() {
  if (!(await maybeConfirmDiscard())) return;
  loadContent(null, '');
}

async function doOpen() {
  if (!(await maybeConfirmDiscard())) return;
  await window.api.openDialog(); // result arrives via onFileOpened
}

async function doSave(forceDialog = false) {
  const result = await window.api.save({
    filePath: state.filePath,
    content: editor.value,
    forceDialog,
  });
  if (!result || result.error) return false;
  state.filePath = result.filePath;
  state.savedContent = editor.value;
  scheduleRender();
  return true;
}

async function doExportHtml() {
  const html = buildStandaloneHtml();
  await window.api.exportHtml({
    html,
    title: (baseName(state.filePath) || 'export').replace(/\.[^.]+$/, ''),
  });
}

function buildStandaloneHtml() {
  const title = (baseName(state.filePath) || 'Markdown Export').replace(/\.[^.]+$/, '');
  const body = renderMarkdown(editor.value);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>${exportStyles}</style>
</head>
<body class="markdown-body">
${body}
</body>
</html>`;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---- Editor formatting helpers ------------------------------------------

function surroundSelection(before, after = before, placeholder = '') {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const value = editor.value;
  const selected = value.slice(start, end) || placeholder;
  const replacement = before + selected + after;
  editor.setRangeText(replacement, start, end, 'end');
  if (!value.slice(start, end)) {
    // Place cursor inside the wrapper on empty selection.
    const caret = start + before.length + placeholder.length;
    editor.setSelectionRange(start + before.length, caret);
  }
  editor.focus();
  scheduleRender();
}

function prefixLines(prefix, { numbered = false } = {}) {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const value = editor.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const block = value.slice(lineStart, end);
  const lines = block.split('\n');
  const out = lines
    .map((l, i) => (numbered ? `${i + 1}. ` : prefix) + l)
    .join('\n');
  editor.setRangeText(out, lineStart, end, 'end');
  editor.focus();
  scheduleRender();
}

function insertBlock(text) {
  const start = editor.selectionStart;
  const value = editor.value;
  const needsNlBefore = start > 0 && value[start - 1] !== '\n';
  const snippet = (needsNlBefore ? '\n' : '') + text;
  editor.setRangeText(snippet, start, editor.selectionEnd, 'end');
  editor.focus();
  scheduleRender();
}

const FORMATTERS = {
  bold: () => surroundSelection('**', '**', 'bold text'),
  italic: () => surroundSelection('*', '*', 'italic text'),
  strike: () => surroundSelection('~~', '~~', 'strikethrough'),
  code: () => surroundSelection('`', '`', 'code'),
  h1: () => prefixLines('# '),
  h2: () => prefixLines('## '),
  h3: () => prefixLines('### '),
  quote: () => prefixLines('> '),
  ul: () => prefixLines('- '),
  ol: () => prefixLines('', { numbered: true }),
  task: () => prefixLines('- [ ] '),
  hr: () => insertBlock('\n---\n\n'),
  codeblock: () => insertBlock('```\n' + (getSelection() || 'code') + '\n```\n'),
  link: () => {
    const sel = getSelection() || 'link text';
    surroundSelection('[', `](https://)`, sel);
  },
  image: () => insertBlock('![alt text](https://)'),
  table: () =>
    insertBlock(
      '\n| Column A | Column B |\n| -------- | -------- |\n| Cell 1   | Cell 2   |\n\n'
    ),
};

function getSelection() {
  return editor.value.slice(editor.selectionStart, editor.selectionEnd);
}

function applyFormat(name) {
  const fn = FORMATTERS[name];
  if (fn) fn();
}

// ---- Editor UX: tab, list continuation, scroll sync ---------------------

editor.addEventListener('keydown', (e) => {
  // Indent with Tab / Shift+Tab instead of losing focus.
  if (e.key === 'Tab') {
    e.preventDefault();
    if (e.shiftKey) {
      outdent();
    } else {
      surroundSelection('  ', '', '');
    }
    return;
  }
  // Auto-continue lists on Enter.
  if (e.key === 'Enter' && !e.shiftKey) {
    if (continueList()) e.preventDefault();
  }
});

function outdent() {
  const start = editor.selectionStart;
  const value = editor.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineHead = value.slice(lineStart, lineStart + 2);
  if (lineHead === '  ') {
    editor.setRangeText('', lineStart, lineStart + 2, 'end');
    scheduleRender();
  }
}

function continueList() {
  const start = editor.selectionStart;
  if (start !== editor.selectionEnd) return false;
  const value = editor.value;
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const line = value.slice(lineStart, start);
  const m = line.match(/^(\s*)(-|\*|\+|\d+\.)\s(\[[ xX]\]\s)?/);
  if (!m) return false;
  const [full, indent, marker] = m;
  // Empty list item -> end the list.
  if (line.trim() === marker || line.trim() === `${marker} ${(m[3] || '').trim()}`.trim()) {
    editor.setRangeText('', lineStart, start, 'end');
    scheduleRender();
    return true;
  }
  let nextMarker = marker;
  if (/^\d+\.$/.test(marker)) {
    nextMarker = `${parseInt(marker, 10) + 1}.`;
  }
  const task = m[3] ? '[ ] ' : '';
  editor.setRangeText(`\n${indent}${nextMarker} ${task}`, start, start, 'end');
  scheduleRender();
  return true;
}

// Scroll sync: map editor scroll ratio to preview.
let syncing = false;
editor.addEventListener('scroll', () => {
  if (syncing || state.viewMode !== 'split') return;
  syncing = true;
  const ratio =
    editor.scrollTop / Math.max(1, editor.scrollHeight - editor.clientHeight);
  preview.scrollTop = ratio * (preview.scrollHeight - preview.clientHeight);
  requestAnimationFrame(() => (syncing = false));
});

// ---- Split divider drag -------------------------------------------------

let dragging = false;
divider.addEventListener('mousedown', (e) => {
  if (state.viewMode !== 'split') return;
  dragging = true;
  e.preventDefault();
  document.body.style.cursor = 'col-resize';
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const rect = workspace.getBoundingClientRect();
  const pct = ((e.clientX - rect.left) / rect.width) * 100;
  const clamped = Math.min(85, Math.max(15, pct));
  editorPane.style.flexBasis = `${clamped}%`;
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  document.body.style.cursor = '';
});

// ---- Drag & drop to open ------------------------------------------------

['dragover', 'drop'].forEach((evt) =>
  window.addEventListener(evt, (e) => e.preventDefault())
);
window.addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  const filePath = window.electronFilePath?.(file) || file.path;
  if (filePath) {
    if (!(await maybeConfirmDiscard())) return;
    const res = await window.api.readFile(filePath);
    if (res && !res.error) loadContent(res.filePath, res.content);
  } else {
    // Fallback: read via the web File API.
    const text = await file.text();
    if (!(await maybeConfirmDiscard())) return;
    loadContent(null, text);
  }
});

// ---- Wire up toolbar & menu events --------------------------------------

document.getElementById('toolbar').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.format) return applyFormat(btn.dataset.format);
  if (btn.dataset.view) return setViewMode(btn.dataset.view);
  switch (btn.dataset.action) {
    case 'open': return doOpen();
    case 'save': return doSave();
    case 'new': return doNew();
    case 'theme': return toggleTheme();
  }
});

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
window.api.onMenuToggleTheme(toggleTheme);

// Ctrl/Cmd+S etc. also handled natively via menu; keep a safety net here.
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  const k = e.key.toLowerCase();
  if (k === 's') {
    e.preventDefault();
    doSave(e.shiftKey);
  }
});

// Warn before leaving with unsaved changes (belt-and-suspenders alongside main).
window.addEventListener('beforeunload', (e) => {
  if (isDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---- Content constants --------------------------------------------------

const exportStyles = `
body{max-width:820px;margin:2rem auto;padding:0 1.25rem;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.7;color:#24292f}
pre{background:#f6f8fa;padding:1rem;border-radius:8px;overflow:auto}
code{background:rgba(175,184,193,.2);padding:.2em .4em;border-radius:6px;font-size:85%}
pre code{background:none;padding:0}
blockquote{border-left:4px solid #d0d7de;margin:0;padding:0 1rem;color:#57606a}
table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:.4rem .8rem}
img{max-width:100%}h1,h2{border-bottom:1px solid #d0d7de;padding-bottom:.3em}
a{color:#0969da}
`;

const WELCOME = `# Welcome to Markdown Viewer 👋

A fast, simple **Markdown editor + live preview** for Windows, macOS, and Linux.

## Getting started

- Press **Open** (or \`Ctrl/Cmd+O\`) to open a \`.md\` file
- Just start typing — the preview updates live
- Use the toolbar or shortcuts to format text
- Toggle **Editor / Split / Preview** with \`Ctrl/Cmd+1/2/3\`
- Switch **dark / light** theme with the ☾ button

## Formatting examples

Here is \`inline code\`, **bold**, *italic*, and ~~strikethrough~~.

> Blockquotes look like this.

\`\`\`js
// Fenced code blocks get syntax highlighting
function greet(name) {
  return \`Hello, \${name}!\`;
}
\`\`\`

| Feature        | Supported |
| -------------- | :-------: |
| GFM tables     |    ✅     |
| Task lists     |    ✅     |
| Syntax colors  |    ✅     |

- [x] Open a file
- [ ] Write something great

Happy writing!
`;

// ---- Init ---------------------------------------------------------------

(function init() {
  try {
    const saved = localStorage.getItem('mdviewer.theme');
    setTheme(saved === 'light' || saved === 'dark' ? saved : 'dark');
  } catch (_) {
    setTheme('dark');
  }
  setViewMode('split');
  loadContent(null, WELCOME);
  state.savedContent = ''; // welcome text counts as empty/new doc
  reportDirty();
})();
