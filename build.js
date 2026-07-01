// Bundles the renderer (marked + DOMPurify + highlight.js + app code) into a
// single file so the renderer can stay sandboxed (contextIsolation on,
// nodeIntegration off) and work fully offline.
const esbuild = require('esbuild');
const path = require('path');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [path.join(__dirname, 'src/renderer/renderer.js')],
  bundle: true,
  outfile: path.join(__dirname, 'src/renderer/dist/bundle.js'),
  platform: 'browser',
  format: 'iife',
  target: ['chrome120'],
  sourcemap: true,
  minify: !watch,
  logLevel: 'info',
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
