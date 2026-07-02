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

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('esbuild: watching renderer for changes…');
  } else {
    await esbuild.build(options);
    console.log('esbuild: renderer bundle built.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
