/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
'use strict';

import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import markedFootnote from 'marked-footnote';
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

// Obsidian-style callouts:  > [!note] Optional title  /  > body…
// Parsed as a block so line structure survives (a plain blockquote with
// breaks:false would merge the title into the body).
const calloutExtension = {
  extensions: [{
    name: 'callout',
    level: 'block',
    start(src) { const i = src.indexOf('> [!'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^> ?\[!(\w+)\]([+-]?)([^\n]*)\n?((?:>[^\n]*(?:\n|$))*)/.exec(src);
      if (!m) return;
      const body = m[4].replace(/^> ?/gm, '');
      return {
        type: 'callout',
        raw: m[0],
        variant: m[1].toLowerCase(),
        title: m[3].trim(),
        tokens: this.lexer.blockTokens(body),
      };
    },
    renderer(token) {
      const body = this.parser.parse(token.tokens);
      const label = token.title || (token.variant.charAt(0).toUpperCase() + token.variant.slice(1));
      return `<div class="callout callout-${token.variant}"><div class="callout-title">${escapeHtml(label)}</div><div class="callout-body">${body}</div></div>\n`;
    },
  }],
};

// :shortcode: emoji for a curated common set (unknown codes are left as text).
const EMOJI = {
  smile: '😄', smiley: '😃', grin: '😁', laughing: '😆', joy: '😂', rofl: '🤣',
  wink: '😉', blush: '😊', heart_eyes: '😍', kissing_heart: '😘', thinking: '🤔',
  neutral_face: '😐', unamused: '😒', sweat_smile: '😅', sob: '😭', cry: '😢',
  angry: '😠', rage: '😡', disappointed: '😞', sleeping: '😴', mask: '😷',
  sunglasses: '😎', confused: '😕', worried: '😟', scream: '😱', flushed: '😳',
  innocent: '😇', nerd: '🤓', clown: '🤡', cowboy: '🤠', shrug: '🤷', facepalm: '🤦',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', ok_hand: '👌', fist: '✊',
  punch: '👊', wave: '👋', raised_hands: '🙌', pray: '🙏', clap: '👏', muscle: '💪',
  point_up: '👆', point_down: '👇', point_left: '👈', point_right: '👉', v: '✌️',
  eyes: '👀', brain: '🧠', heart: '❤️', broken_heart: '💔', two_hearts: '💕',
  sparkling_heart: '💖', blue_heart: '💙', green_heart: '💚', yellow_heart: '💛',
  purple_heart: '💜', fire: '🔥', star: '⭐', star2: '🌟', sparkles: '✨', zap: '⚡',
  boom: '💥', tada: '🎉', confetti_ball: '🎊', gift: '🎁', balloon: '🎈', rocket: '🚀',
  sunny: '☀️', cloud: '☁️', rainbow: '🌈', snowflake: '❄️', moon: '🌙', earth_americas: '🌎',
  white_check_mark: '✅', check: '✅', heavy_check_mark: '✔️', x: '❌', warning: '⚠️',
  question: '❓', exclamation: '❗', bulb: '💡', bell: '🔔', lock: '🔒', key: '🔑',
  mag: '🔍', link: '🔗', pushpin: '📌', calendar: '📅', memo: '📝', pencil: '✏️',
  book: '📖', books: '📚', email: '📧', phone: '📱', computer: '💻', gear: '⚙️',
  wrench: '🔧', hammer: '🔨', bug: '🐛', rotating_light: '🚨', hourglass: '⏳',
  watch: '⌚', coffee: '☕', pizza: '🍕', beer: '🍺', cake: '🎂', tada2: '🥳',
  100: '💯', ok: '🆗', new: '🆕', up: '🆙', top: '🔝', heavy_plus_sign: '➕',
  arrow_right: '➡️', arrow_left: '⬅️', arrow_up: '⬆️', arrow_down: '⬇️',
  hand: '✋', raised_hand: '✋', tada3: '🎉', dart: '🎯', trophy: '🏆', medal: '🏅',
};
const emojiExtension = {
  extensions: [{
    name: 'emoji',
    level: 'inline',
    start(src) { const i = src.indexOf(':'); return i < 0 ? undefined : i; },
    tokenizer(src) {
      const m = /^:([a-z0-9_+-]+):/.exec(src);
      if (m && EMOJI[m[1]]) return { type: 'emoji', raw: m[0], text: EMOJI[m[1]] };
    },
    renderer(token) { return token.text; },
  }],
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
  calloutExtension,
  emojiExtension,
  { gfm: true, breaks: false }
);
// Footnotes: [^1] references + [^1]: definitions, rendered as a footnotes
// section with back-links. Added via use() so it composes with the extensions.
marked.use(markedFootnote());

// Split a leading YAML-ish front-matter block (--- … ---) off the top and
// render its key/value pairs as a small metadata card above the document.
function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { fm: null, body: text };
  return { fm: m[1], body: text.slice(m[0].length) };
}

function frontMatterHtml(fm) {
  const rows = fm.split('\n').map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return null;
    const i = line.indexOf(':');
    if (i < 0) return null;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    return key ? [key, val] : null;
  }).filter(Boolean);
  if (!rows.length) return '';
  return '<div class="frontmatter">' + rows.map(([k, v]) =>
    `<div class="fm-row"><span class="fm-key">${escapeHtml(k)}</span><span class="fm-val">${escapeHtml(v)}</span></div>`
  ).join('') + '</div>';
}

function renderMarkdown(text) {
  const { fm, body } = splitFrontMatter(text || '');
  const raw = (fm != null ? frontMatterHtml(fm) : '') + marked.parse(body);
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

// Workspace-level state (shared across tabs).
const state = { viewMode: 'split', theme: 'dark', zen: false, outlineOpen: false };

// Open documents. Only the ACTIVE tab's text lives in the CodeMirror editor;
// switching tabs swaps content/caret/scroll in and out. Each tab tracks its
// on-disk `savedContent` for dirty detection.
let tabSeq = 0;
const tabs = [];
let activeId = null;
let welcomeId = null; // the initial scratch tab, dropped when a real file opens
function active() { return tabs.find((t) => t.id === activeId) || null; }
// Tell main the full set of open files to watch for external changes.
function updateWatched() { window.api.setWatchedPaths?.(tabs.map((t) => t.filePath).filter(Boolean)); }
function tabText(t) { return t.id === activeId ? editor.value : t.content; }
function tabIsDirty(t) { return tabText(t) !== t.savedContent; }
function anyDirty() { return tabs.some(tabIsDirty); }

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
const tabStrip = $('tabstrip');

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
  pushSession(); // keep the session snapshot fresh (esp. unsaved buffers)
  clearTimeout(evtTimer);
  evtTimer = setTimeout(() => {
    window.api.emitEvent?.('changed', { filePath: active() && active().filePath, dirty: isDirty() });
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

function isDirty() { const a = active(); return a ? editor.value !== a.savedContent : false; }

function reportDirty() {
  const d = isDirty();
  dirtyDot.hidden = !d;
  window.api.reportDirty(anyDirty()); // main confirms on close if ANY tab is dirty
  document.title = `${d ? '• ' : ''}${baseName(active() && active().filePath) || 'Untitled'} — Markdown Viewer`;
  renderTabs();
}

function baseName(p) { return p ? p.split(/[\\/]/).pop() : null; }

function prefersReducedMotion() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
}

function updateStatus() {
  const text = editor.value;
  const words = (text.trim().match(/\S+/g) || []).length;
  wordCountEl.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  charCountEl.textContent = `${text.length} chars`;
  const mins = Math.max(words ? 1 : 0, Math.round(words / 200));
  readTimeEl.textContent = `${mins} min read`;
  fileNameEl.textContent = baseName(active() && active().filePath) || 'Untitled';
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
      if (t) t.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
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
  editor.setLiveMode(mode === 'live');
}

function toggleZen(force) {
  state.zen = force !== undefined ? force : !state.zen;
  app.classList.toggle('zen', state.zen);
}

// ============================================================
// File operations
// ============================================================

function makeTab(filePath, content) {
  return { id: ++tabSeq, filePath: filePath || null, content, savedContent: content, scrollTop: 0, selStart: 0, selEnd: 0 };
}

// Open content in a new tab, or focus the existing tab for that path.
function openInNewTab(filePath, content) {
  if (filePath) {
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) { activateTab(existing.id, true); return; }
  }
  const tab = makeTab(filePath, content);
  tabs.push(tab);
  activateTab(tab.id, true);
  // Once a real file is opened, drop the initial untouched welcome scratch tab.
  if (filePath && welcomeId != null) {
    const w = tabs.find((t) => t.id === welcomeId);
    if (w && w.id !== tab.id && w.content === WELCOME) { tabs.splice(tabs.indexOf(w), 1); renderTabs(); }
    welcomeId = null;
  }
}

// Make `id` active: stash the outgoing tab's live text/caret/scroll, load target.
function activateTab(id, force) {
  if (id === activeId && !force) return;
  const cur = active();
  if (cur && cur.id !== id) {
    cur.content = editor.value;
    cur.scrollTop = editor.scrollTop;
    cur.selStart = editor.selectionStart;
    cur.selEnd = editor.selectionEnd;
  }
  activeId = id;
  const t = active();
  if (!t) return;
  editor.value = t.content;
  const len = editor.value.length;
  editor.setSelectionRange(Math.min(t.selStart || 0, len), Math.min(t.selEnd || 0, len));
  editor.scrollTop = t.scrollTop || 0;
  updateWatched();
  window.api.emitEvent?.('opened', { filePath: t.filePath });
  renderTabs();
  pushSession();
  scheduleRender();
  editor.focus();
}

async function closeTab(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  const idx = tabs.indexOf(t);
  if (tabIsDirty(t)) {
    if (id !== activeId) activateTab(id, true);
    if (!(await maybeConfirmDiscard())) return;
  }
  tabs.splice(idx, 1);
  updateWatched();
  if (!tabs.length) { openInNewTab(null, ''); return; }
  if (id === activeId) activateTab(tabs[Math.max(0, idx - 1)].id, true);
  else { renderTabs(); pushSession(); }
}

// Render the tab strip (hidden when a single tab is open, for a clean look).
function renderTabs() {
  if (!tabStrip) return;
  tabStrip.hidden = tabs.length <= 1;
  tabStrip.innerHTML = '';
  tabs.forEach((t) => {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === activeId ? ' active' : '');
    const name = baseName(t.filePath) || 'Untitled';
    el.innerHTML = `<span class="tab-name"></span>${tabIsDirty(t) ? '<span class="tab-dirty">●</span>' : ''}<button class="tab-close" tabindex="-1" aria-label="Close tab"><svg class="ic"><use href="#i-close"/></svg></button>`;
    el.querySelector('.tab-name').textContent = name;
    el.title = t.filePath || name;
    el.addEventListener('mousedown', (e) => {
      if (e.target.closest('.tab-close')) { e.preventDefault(); closeTab(t.id); }
      else activateTab(t.id);
    });
    tabStrip.appendChild(el);
  });
  const add = document.createElement('button');
  add.className = 'tab-new';
  add.setAttribute('aria-label', 'New tab (⌘T)');
  add.textContent = '+';
  add.addEventListener('click', doNew);
  tabStrip.appendChild(add);
}

// ---- Session persistence -------------------------------------------------
// Debounced snapshot of the open tabs (saved files by path; unsaved buffers
// inline, capped) so the workspace can be restored on next launch.
let sessionPushTimer;
function pushSession() {
  clearTimeout(sessionPushTimer);
  sessionPushTimer = setTimeout(() => {
    const a = active();
    if (a) a.content = editor.value; // capture the live buffer for the active tab
    window.api.saveSession?.({
      tabs: tabs.map((t) => (t.filePath ? { filePath: t.filePath } : { content: (t.content || '').slice(0, 200000) })),
      activeIndex: tabs.findIndex((t) => t.id === activeId),
    });
  }, 500);
}

async function restoreSession(session) {
  const built = [];
  for (const e of session.tabs) {
    if (e.filePath) {
      const res = await window.api.readFile(e.filePath);
      if (res && !res.error) built.push(makeTab(e.filePath, res.content));
    } else if (typeof e.content === 'string') {
      const t = makeTab(null, e.content); t.savedContent = ''; built.push(t);
    }
  }
  if (!built.length) return;
  tabs.length = 0;
  built.forEach((t) => tabs.push(t));
  welcomeId = null;
  activeId = null; // force a fresh activation
  activateTab(tabs[Math.min(Math.max(0, session.activeIndex | 0), tabs.length - 1)].id, true);
}

async function onSessionRestore({ session, openAfter }) {
  if (session) await restoreSession(session);
  if (openAfter) {
    const res = await window.api.readFile(openAfter);
    if (res && !res.error) openInNewTab(res.filePath, res.content);
  }
}

// A program/agent (or another editor) rewrote the open file on disk.
async function onExternalChange({ filePath, content }) {
  const tab = tabs.find((t) => t.filePath === filePath);
  if (!tab) return;                          // stale watcher for a closed file
  if (content === tab.savedContent) return;  // nothing new (incl. our own save)

  // Background tab: silently update it if it has no unsaved edits; otherwise
  // leave it — the user resolves the conflict when they focus/save it.
  if (tab.id !== activeId) {
    if (tab.content === tab.savedContent) { tab.content = content; tab.savedContent = content; renderTabs(); }
    return;
  }

  // Active tab.
  if (!isDirty()) {
    // Reload silently, keeping the caret/scroll roughly where they were.
    const pos = Math.min(editor.selectionStart, content.length);
    const top = editor.scrollTop;
    editor.value = content;
    tab.savedContent = content;
    scheduleRender();
    editor.setSelectionRange(pos, pos);
    editor.scrollTop = top;
    flash('Reloaded — file changed on disk');
    return;
  }
  // Unsaved edits + disk changed: let the user decide, never clobber silently.
  if (await window.api.confirmReload()) {
    editor.value = content;
    tab.savedContent = content;
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

// Opening now creates a new tab, so there's nothing to discard first.
async function doNew() { openInNewTab(null, ''); }
async function doOpen() { await window.api.openDialog(); }

async function doSave(forceDialog = false) {
  const a = active();
  if (!a) return false;
  const res = await window.api.save({ filePath: a.filePath, content: editor.value, forceDialog });
  if (!res || res.error) return false;
  a.filePath = res.filePath;
  a.savedContent = editor.value;
  updateWatched();
  window.api.emitEvent?.('saved', { filePath: res.filePath });
  scheduleRender();
  return true;
}

async function doExportHtml() {
  await window.api.exportHtml({
    html: buildStandaloneHtml(),
    title: (baseName(active() && active().filePath) || 'export').replace(/\.[^.]+$/, ''),
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
  const title = (baseName(active() && active().filePath) || 'Markdown Export').replace(/\.[^.]+$/, '');
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
    title: (baseName(active() && active().filePath) || 'export').replace(/\.[^.]+$/, ''),
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
    filePath: active() && active().filePath,
    content: editor.value,
    outline: outlineFromSource(),
    wordCount: wordCount(editor.value),
    dirty: isDirty(),
    viewMode: state.viewMode,
    theme: state.theme,
    tabs: tabs.map((t) => ({ filePath: t.filePath, active: t.id === activeId })),
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
    const a = active();
    const target = path || (a && a.filePath);
    if (!target) throw new Error('no file path; provide { "path": ... }');
    const res = await window.api.save({ filePath: target, content: editor.value, forceDialog: false });
    if (!res || res.error) throw new Error(res && res.error ? res.error : 'save failed');
    if (a) { a.filePath = res.filePath; a.savedContent = editor.value; }
    updateWatched();
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

// Drag & drop: image files embed into the document; markdown files open.
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));
window.addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  if (file.type && file.type.startsWith('image/')) { await insertImageFile(file); return; }
  const fp = window.electronFilePath?.(file) || file.path;
  if (fp) {
    const res = await window.api.readFile(fp);
    if (res && !res.error) openInNewTab(res.filePath, res.content);
  } else {
    openInNewTab(null, await file.text());
  }
});

// Embed an image file as a data URI so it renders in the preview and travels
// with the document (works for unsaved buffers and HTML/PDF export alike).
function insertImageFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const alt = (file.name || 'image').replace(/\.[^.]+$/, '');
      const s = editor.selectionStart;
      editor.setRangeText(`![${alt}](${reader.result})`, s, editor.selectionEnd, 'end');
      scheduleRender();
      flash('Image embedded');
      resolve();
    };
    reader.onerror = () => { flash('Could not read image'); resolve(); };
    reader.readAsDataURL(file);
  });
}

// Clipboard: pasted images embed as data URIs; a bare URL pasted over a
// selection becomes a Markdown link. Anything else is a normal paste.
async function onEditorPaste(e) {
  const items = e.clipboardData ? e.clipboardData.items : null;
  if (items) {
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) { e.preventDefault(); await insertImageFile(file); return; }
      }
    }
  }
  const text = ((e.clipboardData && e.clipboardData.getData('text/plain')) || '').trim();
  if (/^https?:\/\/\S+$/.test(text) && editor.selectionEnd > editor.selectionStart) {
    e.preventDefault();
    const s = editor.selectionStart, en = editor.selectionEnd;
    editor.setRangeText(`[${editor.value.slice(s, en)}](${text})`, s, en, 'end');
    scheduleRender();
  }
}

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
  { id: 'vl', label: 'View: Live preview (Typora-style)', key: '⌘4', icon: 'i-live', run: () => setViewMode('live') },
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
  ['New file / tab', '⌘N / ⌘T'], ['Open', '⌘O'], ['Save', '⌘S'], ['Save As', '⌘⇧S'],
  ['Bold', '⌘B'], ['Italic', '⌘I'], ['Insert link', '⌘K'],
  ['Find & replace', '⌘F'], ['Command palette', '⌘⇧P'],
  ['Editor / Split / Preview / Live', '⌘1 / ⌘2 / ⌘3 / ⌘4'], ['Toggle outline', '⌘\\'],
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
// Paste is handled in capture phase so image/URL pastes win over CodeMirror's
// default text paste (we preventDefault only for the cases we handle).
editor.view.contentDOM.addEventListener('paste', onEditorPaste, true);

window.api.onFileOpened(({ filePath, content }) => openInNewTab(filePath, content));
window.api.onExternalChange(onExternalChange);
window.api.onSessionRestore?.(onSessionRestore);
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
  if (k === 't') { e.preventDefault(); doNew(); }
  else if (k === 's') { e.preventDefault(); doSave(e.shiftKey); }
  else if (k === 'f' && e.shiftKey) { e.preventDefault(); toggleZen(); }
  else if (k === 'f') { e.preventDefault(); openFind(); }
  else if (k === 'p' && e.shiftKey) { e.preventDefault(); openPalette(); }
  else if (k === 'l' && e.shiftKey) { e.preventDefault(); cycleTheme(); }
  else if (k === '\\') { e.preventDefault(); toggleOutline(); }
  else if (k === '1') { e.preventDefault(); setViewMode('editor'); }
  else if (k === '2') { e.preventDefault(); setViewMode('split'); }
  else if (k === '3') { e.preventDefault(); setViewMode('preview'); }
  else if (k === '4') { e.preventDefault(); setViewMode('live'); }
});
function isTyping(el) {
  return !!(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    || el.isContentEditable || (el.closest && el.closest('.cm-editor'))));
}

window.addEventListener('beforeunload', (e) => { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } });

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
  // Icon-only controls get an accessible name from their tooltip text.
  document.querySelectorAll('[data-tip]').forEach((el) => {
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', el.getAttribute('data-tip'));
  });
  openInNewTab(null, WELCOME);
  if (active()) { active().savedContent = ''; welcomeId = active().id; } // welcome = scratch, droppable
  reportDirty();
})();
