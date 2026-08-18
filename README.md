# Drive Mode MCP

**Agent → stage write path** for live multi-agent presence with visuals. Built on [`@drive-mode/collaboration-harness`](https://github.com/drive-mode/collaboration-harness).

Five primitives: **presence · spotlight · narration · interrupt · address**.

```text
Agent host(s) --MCP tools--> Writer (single) --events/seq--> Viewer(s)
                                  |
                           packs validate work payloads
```

## Install

Clone **as a sibling** of `collaboration-harness` (file dependency):

```bash
drive-mode/
  collaboration-harness/
  drivemode-mcp/   ← you are here
```

```bash
bun install
```

If you only clone this repo, either clone the harness next door or replace the `file:../../../collaboration-harness` dependency with a git URL you can authenticate to.
# Terminal 1 — single room writer (prints live URLs; port is ephemeral)
bun run writer

# Terminal 2 — viewer
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun run viewer
# open the Vite URL, paste the writer URL into the field (or ?writer=...)

# Terminal 3 — MCP stdio for Cursor / Claude Desktop
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun run --cwd apps/writer mcp
```

Sample MCP configs: [`examples/cursor-mcp.json`](examples/cursor-mcp.json), [`examples/claude-desktop.json`](examples/claude-desktop.json).

Discovery file (written on writer start): `~/.drivemode/writer.json`.

## MCP tools (v0)

| Tool | Primitive |
|---|---|
| `room_join` / `room_leave` / `room_snapshot` | Presence |
| `roster_list` / `roster_set_profile` | Persona + sanitized runtime badge |
| `address_set` | Address |
| `stage_publish_work` / `stage_set_sharer` | Spotlight |
| `title_grant` / `title_transfer` / `title_revoke` | Temporary Agent Titles |
| `mode_set` / `mode_get` | Control |
| `interrupt_raise` / `interrupt_ack` | Interrupt |
| `conversation_publish` | Narration |
| `room_invite` | Session invitation |
| `session_create` / `session_schedule` / `session_start` / `session_end` | Session registry |
| `events_since` | Resume |
| `pack_set` / `pack_list` | Packs |

Session lifecycle is append-only: create → schedule → start → end.
`room_invite` accepts the related `sessionId`, so clients can join an
invitation to the same registry record instead of matching titles.

Agent stage sharing requires an active `Presenter` title. Presenter ownership
is exclusive; transfers and revocations are append-only control events. Title
payloads contain only opaque skill/resource references, never their contents,
and the stage remains typed events rather than pixel streaming.

## Packs

- `coding` — `work.edit`, `work.command`, `work.test`, `work.plan`, `work.decision`, `work.generic`
- `demo-ops` — `work.ops.alert`, `work.ops.runbook_step` (proves non-coding use cases)

## Hard rules

- One writer per room. MCP is a façade (`/rpc` + stdio proxy).
- Tools append **events**, never HTML/UI blobs.
- No prompts, tool allowlists, API keys, endpoints, or model IDs in MCP.
- Privacy-strict: conversation bodies stay in-memory; no transcript/audio persistence by default.
- Do **not** hardcode a magic port as identity. Use the printed URL / discovery file.

## Layout

```text
apps/writer/     # HTTP writer + MCP stdio proxy
apps/viewer/     # React call-feel UI (roster + Spotlight + feed)
packages/packs-coding/
packages/packs-demo-ops/
examples/
```

## Verify

```bash
bun install
bun test
bun run --cwd apps/viewer typecheck
```

## Non-goals (v0)

Multi-room, auth, durable SQLite log, voice/WebRTC, Cline hub bridge.

## License

Apache-2.0
