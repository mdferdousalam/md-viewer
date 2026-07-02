# Automating Markdown Viewer (CLI · Control API · MCP)

Markdown Viewer can be driven by scripts and LLM agents, not just by hand. There are
three layers, smallest to most capable.

## 1. Live reload (always on)

The open document reloads automatically whenever the file changes on disk. So the simplest
integration is: **your program writes the `.md` file, the viewer shows it live.** If you
have unsaved edits in the app, it asks before replacing them.

## 2. Command line

The installer puts a `md-viewer` command on your `PATH`.

```sh
md-viewer notes.md                          # open in the GUI
md-viewer export notes.md --to pdf          # headless -> notes.pdf (no window)
md-viewer export notes.md --to html --out out.html
md-viewer render notes.md --to html         # print rendered HTML to stdout
cat notes.md | md-viewer render - --to html # read from stdin
```

Exports are fully self-contained: Mermaid diagrams, KaTeX math, and syntax highlighting are
baked in.

## 3. Local control API

Start the app with the control API enabled:

```sh
md-viewer --serve            # random port
md-viewer --serve 4114       # fixed port
# or: MDV_API=1 md-viewer
```

**Security.** The server binds to `127.0.0.1` only, every request needs a bearer token, and
the `Host` header must be loopback (blocks DNS-rebinding). It is **off by default**. On
startup the port and token are written to a `0600` discovery file:

- macOS: `~/Library/Application Support/Markdown Viewer/api.json`
- Linux: `~/.config/Markdown Viewer/api.json`
- Windows: `%APPDATA%\Markdown Viewer\api.json`

### Endpoints

| Method | Route | Body / result |
| --- | --- | --- |
| GET | `/health` | `{ ok, version }` |
| GET | `/document` | `{ filePath, content, outline, wordCount, dirty, viewMode, theme }` |
| GET | `/outline` | `{ outline: [{ level, text, line }] }` |
| GET | `/screenshot` | PNG of the rendered window |
| POST | `/open` | `{ path }` |
| PUT | `/document` | `{ content }` |
| POST | `/edit` | `{ op: "append" \| "replaceSection" \| "insertAtHeading" \| "applyFormat" \| "toggleTask" \| "findReplace", ... }` |
| POST | `/view` | `{ mode?, theme?, outline?, zen? }` |
| POST | `/save` | `{ path? }` |
| POST | `/export` | `{ to: "pdf" \| "html", out }` |
| GET | `/events` | Server-Sent Events: `{ type: "opened" \| "saved" \| "changed", ... }` |

`replaceSection` and `insertAtHeading` match a heading by its text and edit only that
section — surgical edits that don't clobber the rest of the document.

### Example

```sh
API=~/"Library/Application Support/Markdown Viewer/api.json"
PORT=$(node -e "console.log(require('$API').port)")
TOK=$(node -e "console.log(require('$API').token)")
curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:$PORT/document
curl -s -H "Authorization: Bearer $TOK" -X POST http://127.0.0.1:$PORT/edit \
  -d '{"op":"replaceSection","heading":"Summary","markdown":"Rewritten by an agent."}'
```

## 4. MCP server (for Claude Desktop / Claude Code)

The `mcp/` folder is a stdio [MCP](https://modelcontextprotocol.io) server that exposes the
control API as typed tools. It requires the app to be running with `--serve`.

```sh
cd mcp && npm install
```

Add it to your MCP client config (adjust the path):

```json
{
  "mcpServers": {
    "md-viewer": {
      "command": "node",
      "args": ["/absolute/path/to/md-viewer/mcp/index.js"]
    }
  }
}
```

### Tools

`open_document`, `get_document`, `get_outline`, `set_document`, `append_markdown`,
`replace_section`, `insert_at_heading`, `set_view`, `save`, `render_to_html`,
`render_to_pdf`, and `screenshot_preview` — the last returns a PNG so a vision model can
*see* the rendered result (diagrams, math, layout) and self-correct. Tool errors surface the
underlying problem (e.g. a bad Mermaid block, or "app not running") so the agent can react.
