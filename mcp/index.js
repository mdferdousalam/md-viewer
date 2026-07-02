#!/usr/bin/env node
/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */

// MCP server exposing the Markdown Viewer as typed tools for LLM agents
// (Claude Desktop, Claude Code, etc.). It talks to a running instance of the
// app via its local control API — start the app with `md-viewer --serve`.
// This server makes no model/API calls; it only wraps the local HTTP API.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Where Electron writes the app's userData (and our api.json discovery file).
function userDataDir() {
  const name = 'Markdown Viewer';
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readDiscovery() {
  const f = path.join(userDataDir(), 'api.json');
  if (!fs.existsSync(f)) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

async function reachable(d) {
  if (!d || !d.port || !d.token) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${d.port}/health`, { headers: { Authorization: `Bearer ${d.token}` } });
    if (!res.ok) return false;
    const body = await res.json().catch(() => ({}));
    return body.ready === true; // wait until the renderer can service requests
  } catch { return false; }
}

// Launch the viewer with the control API enabled. MDV_SERVE_ARGV is set by the
// `md-viewer mcp` subcommand; fall back to the `md-viewer` PATH shim otherwise.
// ELECTRON_RUN_AS_NODE must be cleared so we boot the real GUI app, not Node mode.
function launchApp() {
  let argv = null;
  try { argv = JSON.parse(process.env.MDV_SERVE_ARGV || 'null'); } catch { /* ignore */ }
  if (!Array.isArray(argv) || !argv.length) argv = ['md-viewer', '--serve'];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(argv[0], argv.slice(1), { detached: true, stdio: 'ignore', env }).unref();
}

let cached = null;
let ensuring = null;
function ensureApi() {
  if (cached) return Promise.resolve(cached);
  if (ensuring) return ensuring;
  ensuring = (async () => {
    let d = readDiscovery();
    if (await reachable(d)) { cached = d; return cached; }
    // Not running (or stale discovery file) — start it and wait for readiness.
    launchApp();
    for (let i = 0; i < 40; i++) { // ~20s
      await sleep(500);
      d = readDiscovery();
      if (await reachable(d)) { cached = d; return cached; }
    }
    throw new Error('Started Markdown Viewer but its control API did not come up. Try launching it manually: md-viewer --serve');
  })();
  ensuring.finally(() => { ensuring = null; });
  return ensuring;
}

async function call(method, route, body) {
  const { port, token } = await ensureApi();
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}${route}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    cached = null; // connection died — re-discover / relaunch on the next call
    throw new Error(`Lost connection to Markdown Viewer (${e.code || e.message}).`);
  }
  if (!res.ok) throw new Error(`${method} ${route} → ${res.status}: ${await res.text()}`);
  return res;
}

const textResult = (t) => ({ content: [{ type: 'text', text: typeof t === 'string' ? t : JSON.stringify(t, null, 2) }] });
const jsonCall = async (method, route, body) => textResult(await (await call(method, route, body)).json());

// Every tool handler runs through this so a failure becomes a clean tool error
// (e.g. a Mermaid/KaTeX problem or "app not running") the model can act on.
const wrap = (fn) => async (args) => {
  try { return await fn(args || {}); }
  catch (e) { return { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true }; }
};

const server = new McpServer({ name: 'md-viewer', version: '1.1.0' });

server.tool('open_document', 'Open a Markdown file in the viewer.',
  { path: z.string().describe('Absolute path to a Markdown file') },
  wrap(({ path: p }) => jsonCall('POST', '/open', { path: p })));

server.tool('get_document', 'Get the current document: content, heading outline, word count, dirty state, view mode and theme.',
  {}, wrap(() => jsonCall('GET', '/document')));

server.tool('get_outline', 'Get the document heading outline (level, text, line number).',
  {}, wrap(() => jsonCall('GET', '/outline')));

server.tool('set_document', 'Replace the entire document content.',
  { markdown: z.string() },
  wrap(({ markdown }) => jsonCall('PUT', '/document', { content: markdown })));

server.tool('append_markdown', 'Append Markdown to the end of the document.',
  { markdown: z.string() },
  wrap(({ markdown }) => jsonCall('POST', '/edit', { op: 'append', markdown })));

server.tool('replace_section', 'Replace the body under a heading (matched by its text), keeping the heading line. Surgical edit that leaves the rest of the document untouched.',
  { heading: z.string().describe('Exact heading text, without the # marks'), markdown: z.string() },
  wrap(({ heading, markdown }) => jsonCall('POST', '/edit', { op: 'replaceSection', heading, markdown })));

server.tool('insert_at_heading', 'Insert Markdown immediately before or after a heading (matched by its text).',
  { heading: z.string(), markdown: z.string(), position: z.enum(['before', 'after']).default('after') },
  wrap(({ heading, markdown, position }) => jsonCall('POST', '/edit', { op: 'insertAtHeading', heading, markdown, position })));

server.tool('set_view', 'Set the view mode and/or color theme.',
  { mode: z.enum(['editor', 'split', 'preview']).optional(), theme: z.enum(['dark', 'light', 'sepia']).optional() },
  wrap((a) => jsonCall('POST', '/view', a)));

server.tool('save', 'Save the document to disk (its current path, or a given path).',
  { path: z.string().optional() },
  wrap((a) => jsonCall('POST', '/save', a)));

server.tool('render_to_html', 'Export the current document to a self-contained HTML file (diagrams, math and highlighting baked in).',
  { out: z.string().describe('Output .html path') },
  wrap(({ out }) => jsonCall('POST', '/export', { to: 'html', out })));

server.tool('render_to_pdf', 'Export the current document to a PDF file.',
  { out: z.string().describe('Output .pdf path') },
  wrap(({ out }) => jsonCall('POST', '/export', { to: 'pdf', out })));

server.tool('screenshot_preview', 'Capture the rendered preview as a PNG image so you can see exactly how the document looks (useful for verifying diagrams, math and layout).',
  {}, wrap(async () => {
    const res = await call('GET', '/screenshot');
    const buf = Buffer.from(await res.arrayBuffer());
    return { content: [{ type: 'image', data: buf.toString('base64'), mimeType: 'image/png' }] };
  }));

// Async IIFE (not top-level await) so this bundles cleanly to CommonJS for the
// `md-viewer mcp` subcommand as well as running as ESM standalone.
(async () => {
  await server.connect(new StdioServerTransport());
})();
