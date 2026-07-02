/* Copyright (c) 2026 Ferdous. All Rights Reserved.
   Unauthorized use, copying, modification, or distribution of this source is
   prohibited. See LICENSE. */
'use strict';

// Parses the command line into an action. Recognised forms:
//
//   md-viewer <file>                       open <file> in the GUI (default)
//   md-viewer open <file>                  open <file> in the GUI
//   md-viewer export <file> --to pdf|html [--out <path>]   headless export
//   md-viewer render <file|-> [--to html]  headless render to stdout (- = stdin)
//   md-viewer mcp                          run the MCP stdio server
//
// Returns null for anything unrecognised so the caller falls back to the
// existing GUI file-argument behaviour. `headless: true` means "do the job
// without a visible window, then exit".

const VERBS = new Set(['open', 'export', 'render', 'mcp']);

function parseCli(argv, isPackaged) {
  // In a packaged app argv is [exe, ...args]; running via `electron .` it is
  // [electron, '.', ...args].
  const args = argv.slice(isPackaged ? 1 : 2);
  if (!args.length) return null;

  const cmd = VERBS.has(args[0]) ? args[0] : null;
  const rest = cmd ? args.slice(1) : args;

  const opts = { to: null, out: null, help: false, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--to' || a === '-t') opts.to = rest[++i];
    else if (a === '--out' || a === '-o') opts.out = rest[++i];
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '-' || !a.startsWith('-')) opts.positional.push(a); // '-' = stdin
  }
  const file = opts.positional[0] || null;

  if (cmd === 'export') {
    return { headless: true, command: 'export', file, to: (opts.to || '').toLowerCase(), out: opts.out };
  }
  if (cmd === 'render') {
    return { headless: true, command: 'render', file, to: (opts.to || 'html').toLowerCase(), out: opts.out };
  }
  if (cmd === 'mcp') {
    return { command: 'mcp' };
  }
  if (cmd === 'open') {
    return { headless: false, command: 'open', file };
  }
  return null; // bare path or unknown -> GUI falls back to firstMarkdownArg
}

module.exports = { parseCli };
