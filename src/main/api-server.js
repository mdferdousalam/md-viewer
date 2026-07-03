/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
'use strict';

// Opt-in local control API so scripts and LLM agents can drive the running
// viewer. SECURITY: bound to 127.0.0.1 only, every request needs the bearer
// token, and the Host header must be loopback (blocks DNS-rebinding from a web
// page). The token + port are written to a 0600 discovery file so a local
// client (the MCP server) can find them. Events are delivered over Server-Sent
// Events — no extra dependency, and commands are plain HTTP.

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function startApiServer(ctx) {
  const token = crypto.randomBytes(24).toString('hex');
  const sseClients = new Set();
  const discoveryFile = path.join(ctx.userDataDir, 'api.json');

  const sendJson = (res, code, obj) => {
    const body = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': body.length });
    res.end(body);
  };
  const sendErr = (res, code, message) => sendJson(res, code, { error: message });

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size > 25 * 1024 * 1024) { reject(new Error('request body too large')); req.destroy(); return; }
        data += c;
      });
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch (_) { reject(new Error('invalid JSON body')); }
      });
      req.on('error', reject);
    });
  }

  // Reject anything not from loopback with the right token. The Host check
  // stops a malicious web page from pointing a DNS name at 127.0.0.1.
  function authorized(req) {
    if (req.headers.authorization !== `Bearer ${token}`) return false;
    const host = (req.headers.host || '').split(':')[0];
    if (host !== '127.0.0.1' && host !== 'localhost') return false;
    return true;
  }

  const req2 = (op, args) => ctx.rendererRequest(ctx.getWindow(), op, args);

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1');
      const p = u.pathname;
      const m = req.method;

      if (!authorized(req)) return sendErr(res, 401, 'unauthorized');
      const win = ctx.getWindow();
      if (!win) return sendErr(res, 503, 'no window available');

      // ---- events (Server-Sent Events) ----
      if (m === 'GET' && p === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('retry: 3000\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      // ---- read-only ----
      if (m === 'GET' && p === '/health') {
        // `ready` = the renderer window has finished loading, so renderer-backed
        // routes (/document, /edit, …) will actually respond. Clients wait on this.
        return sendJson(res, 200, { ok: true, ready: !win.webContents.isLoading(), version: ctx.version });
      }
      if (m === 'GET' && p === '/document') {
        return sendJson(res, 200, await req2('getDocument'));
      }
      if (m === 'GET' && p === '/outline') {
        return sendJson(res, 200, { outline: (await req2('getDocument')).outline });
      }
      if (m === 'GET' && p === '/tabs') {
        return sendJson(res, 200, await req2('listTabs'));
      }
      if (m === 'GET' && p === '/screenshot') {
        const img = await win.webContents.capturePage();
        const png = img.toPNG();
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
        res.end(png);
        return;
      }

      // ---- mutations ----
      if (m === 'POST' && p === '/open') {
        const { path: fp } = await readBody(req);
        if (!fp) return sendErr(res, 400, 'missing "path"');
        ctx.openPath(win, fp);
        return sendJson(res, 200, { ok: true });
      }
      if (m === 'PUT' && p === '/document') {
        const { content } = await readBody(req);
        if (typeof content !== 'string') return sendErr(res, 400, 'missing "content" string');
        return sendJson(res, 200, await req2('setContent', { content }));
      }
      if (m === 'POST' && p === '/edit') {
        const body = await readBody(req);
        if (!body.op) return sendErr(res, 400, 'missing "op"');
        return sendJson(res, 200, await req2('edit', body));
      }
      if (m === 'POST' && p === '/view') {
        return sendJson(res, 200, await req2('setView', await readBody(req)));
      }
      if (m === 'POST' && p === '/tabs/activate') {
        return sendJson(res, 200, await req2('activateTabRef', await readBody(req)));
      }
      if (m === 'POST' && p === '/tabs/close') {
        return sendJson(res, 200, await req2('closeTabRef', await readBody(req)));
      }
      if (m === 'POST' && p === '/save') {
        return sendJson(res, 200, await req2('save', await readBody(req)));
      }
      if (m === 'POST' && p === '/export') {
        const { to, out } = await readBody(req);
        if (to !== 'pdf' && to !== 'html' && to !== 'docx') return sendErr(res, 400, 'to must be "pdf", "html" or "docx"');
        if (!out) return sendErr(res, 400, 'missing "out" path');
        if (to === 'docx') fs.writeFileSync(out, await req2('getWordHtml'), 'utf8');
        else if (to === 'html') fs.writeFileSync(out, await req2('getExportHtml'), 'utf8');
        else fs.writeFileSync(out, await ctx.htmlToPdf(await req2('getExportHtml')));
        return sendJson(res, 200, { path: out });
      }

      return sendErr(res, 404, `no route for ${m} ${p}`);
    } catch (err) {
      if (!res.headersSent) sendErr(res, 500, err && err.message ? err.message : String(err));
    }
  });

  server.on('error', (err) => {
    process.stderr.write(`md-viewer: control API failed to start: ${err.message}\n`);
  });

  server.listen(ctx.port || 0, '127.0.0.1', () => {
    const actualPort = server.address().port;
    try {
      fs.writeFileSync(
        discoveryFile,
        JSON.stringify({ port: actualPort, token, pid: process.pid, version: ctx.version }, null, 2),
        { mode: 0o600 }
      );
    } catch (_) { /* non-fatal */ }
    process.stdout.write(`Markdown Viewer control API: http://127.0.0.1:${actualPort}  (token in ${discoveryFile})\n`);
  });

  function broadcast(evt) {
    const line = `data: ${JSON.stringify(evt)}\n\n`;
    for (const res of sseClients) { try { res.write(line); } catch (_) {} }
  }

  function close() {
    for (const res of sseClients) { try { res.end(); } catch (_) {} }
    sseClients.clear();
    try { server.close(); } catch (_) {}
    try { fs.unlinkSync(discoveryFile); } catch (_) {}
  }

  // Best-effort cleanup if the process exits without a clean app quit.
  process.once('exit', () => { try { fs.unlinkSync(discoveryFile); } catch (_) {} });

  return { broadcast, close, token };
}

module.exports = { startApiServer };
