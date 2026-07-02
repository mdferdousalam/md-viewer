/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
// Bundles the renderer (marked + DOMPurify + highlight.js + KaTeX + Mermaid +
// app code) into a single JS + CSS pair so the renderer stays sandboxed
// (contextIsolation on, nodeIntegration off) and works fully offline.
const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(__dirname, 'src/renderer/renderer.js')],
  bundle: true,
  outdir: path.join(__dirname, 'src/renderer/dist'),
  entryNames: 'bundle',
  assetNames: '[name]',
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
  // KaTeX ships a CSS file that references web fonts; inline them as data URLs
  // so there are no extra files to serve and no font-src headaches.
  loader: {
    '.woff2': 'dataurl',
    '.woff': 'dataurl',
    '.ttf': 'dataurl',
  },
};

// The MCP server, bundled into ONE self-contained CommonJS file (SDK + zod
// inlined). Shipped as an extraResource so `md-viewer mcp` can run it in Node
// mode without any node_modules resolution or ESM-in-asar trouble.
const mcpOptions = {
  entryPoints: [path.join(__dirname, 'mcp/index.js')],
  bundle: true,
  outfile: path.join(__dirname, 'mcp/dist/server.cjs'),
  platform: 'node',
  format: 'cjs',
  target: ['node18'],
  minify: !watch,
  logLevel: 'info',
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    const mcpCtx = await esbuild.context(mcpOptions);
    await mcpCtx.watch();
    console.log('esbuild: watching renderer + MCP server for changes…');
  } else {
    await Promise.all([esbuild.build(options), esbuild.build(mcpOptions)]);
    console.log('esbuild: renderer + MCP server bundles built.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
