# CLAUDE.md — drivemode-mcp

Guidance for Claude Code (and other coding agents) working in this repository.

`AGENTS.md` is the short mission/do/don't contract; this file is the longer
orientation. Read both. Where they disagree, `AGENTS.md` wins.

@AGENTS.md

---

## What this repository is

Drive Mode MCP is the **agent → stage write path**. It turns MCP tool calls from
any host (Cursor, Claude Desktop, Claude Code, an SDK agent) into typed room
events, and serves those events to viewers so a human sees a live, shared
Spotlight of what several agents are doing.

```text
Agent host(s) --MCP stdio--> mcp-stdio proxy --HTTP /rpc--> Writer (single)
                                                              |  events + seq
                                                              v
                                                          Viewer(s)  (SSE)
```

All room semantics — schemas, the fold, policies — live in
generated [`@drive-mode/drive-kernel`](https://github.com/drive-mode/cline-drivecode)
(`@cline/drive` is the source). This repo is the **host**: transport, a
single-writer store (no-Hub profile), pack validation, and a reference UI.
**Do not re-implement `reduceRoom` here.** **Do not import `@cline/*`.**

### Where it sits in the Drive Mode family

| Repo | Role |
|---|---|
| [`cline-drivecode`](https://github.com/drive-mode/cline-drivecode) | Canonical kernel + generated `@drive-mode/drive-kernel` |
| **drivemode-mcp** (this) | MCP writer + reference viewer for any MCP host |
| [`drive-ios`](https://github.com/drive-mode/drive-ios) | SwiftUI client; polls this writer's `/rpc events_since` |
| [`site`](https://github.com/drive-mode/site) | drivemode.ai static site |
| `collaboration-harness` | **Archived.** Do not take a `file:` dependency on it. |

When a Cline Hub is live for the same room, Hub is the writer (ADR-0057). This
MCP writer is the standalone profile for hosts without Hub.

## Setup — clone as a sibling

Generate the kernel bundle from a sibling `cline-drivecode` clone:

```text
drive-mode/
  cline-drivecode/        # bun run build:sdk && bun run build:drive-kernel
  drivemode-mcp/          <- you are here
```

```bash
bun install
```

The writer `file:` dependency is `../../../cline-drivecode/sdk/dist-bundle/drive-kernel`.
`bunfig.toml` also configures the `@drive-mode` scope against GitHub Packages
(`GITHUB_TOKEN`) for the published-package path.

## Commands

```bash
bun test                        # the suite — tests/ (root-level, uses bun:test)
bun run typecheck               # every workspace's typecheck
bun run check                   # typecheck + test + writer build
bun run writer                  # start the single-room writer (prints live URLs)
bun run viewer                  # Vite dev server for the reference viewer
bun run --cwd apps/writer mcp   # MCP stdio proxy -> DRIVEMODE_WRITER_URL
bun run --cwd apps/viewer typecheck

node demo/demo.mjs doctor       # demo prerequisites, with the fix for each
node demo/demo.mjs record       # start the stack, film the demo, encode an MP4
node demo/demo.mjs down         # stop whatever the demo started
```

Typical three-terminal loop:

```bash
# 1) writer — prints an ephemeral port; read the URL from the terminal
bun run writer

# 2) viewer
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun run viewer

# 3) MCP stdio for Cursor / Claude Desktop
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun run --cwd apps/writer mcp
```

Sample host configs: `examples/cursor-mcp.json`, `examples/claude-desktop.json`.
On start the writer also drops a discovery file at `~/.drivemode/writer.json`
(`url`, `port`, `roomId`, `pid`, `startedAt`).

## Layout

```text
apps/writer/src/
  cli.ts          # process entry: build store -> service -> HTTP, write discovery file, print URLs
  store.ts        # WriterStore — append-only log, seq counter, snapshot via reduceRoom
  roomService.ts  # the real API surface; pack registry + work-event mapping (largest file)
  http.ts         # Bun.serve: /health /snapshot /rpc /events (SSE) /api/raise-hand
  mcpServer.ts    # MCP tool definitions (in-process server)
  mcp-stdio.ts    # stdio façade that proxies every tool to a running writer's /rpc
apps/viewer/src/  # React 19 + Vite reference UI (roster + Spotlight + feed)
packages/packs-*/ # per-domain Zod validators for work payloads
tests/            # acceptance.test.ts, packs-fleet.test.ts, subscriber-isolation.test.ts,
                  # log-identity.test.ts, idempotent-publish.test.ts, sse-wire.test.ts
demo/             # end-to-end demo: scenario, iPhone recreation, recorder
docs/             # DDIA-LESSONS.md — the data-intensity rationale for the wire
examples/         # MCP host configs
```

### The single writer

`createWriterStore` owns one room (`roomId: "default"`). `append(event)`:
assigns the next `seq`, pushes a room `DriveLogEnvelope`, folds it with the
kernel's `reduceRoom`, and notifies subscribers. `seq` is the resume cursor — clients call
`events_since` / `GET /events?since=N` and never guess from a wall clock.

`seq` is only meaningful **relative to a log incarnation**: the store mints a
`logId` per creation, and every read surface names it (`/health`, `/snapshot`,
`events_since`, the SSE `hello`, the discovery file). Clients resync when it
changes — that is what catches a restarted writer whose fresh log has already
grown past an old cursor. SSE messages are addressed `id: <logId>:<seq>` and
reconnects honor `Last-Event-ID`; consumers whose unread queue passes
`sseMaxBufferedMessages` are shed (the replayable log makes that safe).
`stage_publish_work` / `conversation_publish` accept an optional `opId` retry
key that replays the recorded result instead of appending a duplicate. The
reasoning for all of this lives in `docs/DDIA-LESSONS.md` — keep new wire
fields additive, and keep event envelopes untouched (identity rides on
responses, not in the log).

`control.end` is **idempotent** until a successful `control.join` reopens the
room; that mirrors the Cline coordinator so folds agree across hosts. Keep it
that way — configuration calls and rejected ops must not authorize a second
`control.end` append.

Conversation bodies live in an in-memory feed capped at 200 entries and are never
written to the log's durable payloads.

### Packs

A pack is a Zod validator for `work.*` payloads, registered in `roomService.ts`'s
`packs` map. `stage_publish_work` validates against the active pack (or an
explicit `packId`) and then maps the result onto kernel events. Coding pack
`work.plan` / `work.test` become `work.plan_step` / `work.test_result`. The
kernel never special-cases a pack — fleet packs ride `work.generic`.

| Pack id | Work types |
|---|---|
| `coding` | `work.edit` `work.command` `work.test` `work.plan` `work.decision` `work.generic` |
| `demo-ops` | `work.ops.alert` `work.ops.runbook_step` |
| `tasks` | `work.task.created` `work.task.state` `work.task.progress` |
| `artifacts` | `work.artifact.created` `work.artifact.lifecycle` `work.artifact.superseded` |
| `direction` | `work.direction.beat` |

Adding a pack: new `packages/packs-<name>/` (mirror an existing one's
`package.json`/`tsconfig.json`), export `{ id, schemaVersion, validate }`, add it
to `apps/writer/package.json` dependencies and the `packs` map, add the
`packId` branch that maps validated payloads to events, and cover it in
`tests/packs-fleet.test.ts`.

### MCP tools

Grouped by primitive; defined in `mcpServer.ts`, dispatched in `http.ts`, and
implemented in `roomService.ts`.

| Primitive | Tools |
|---|---|
| Presence | `room_join` `room_leave` `room_snapshot` `room_end` |
| Roster | `roster_list` `roster_set_profile` |
| Address | `address_set` |
| Spotlight | `stage_publish_work` `stage_set_sharer` |
| Titles | `title_grant` `title_transfer` `title_revoke` |
| Control | `mode_set` `mode_get` |
| Interrupt | `interrupt_raise` `interrupt_ack` |
| Narration | `conversation_publish` |
| Sessions | `room_invite` `session_create` `session_schedule` `session_start` `session_end` |
| Resume | `events_since` |
| Packs | `pack_set` `pack_list` |

A new tool touches four places: `mcpServer.ts` (definition + input schema),
`http.ts` `dispatchRpc` (the `/rpc` case), `roomService.ts` (behavior), and
`mcp-stdio.ts` (the proxied tool). Miss one and the tool works over HTTP but not
over stdio, or vice versa.

## The demo

`demo/` is the end-to-end demo and its recorder. It exercises every MCP
primitive and all five packs against a running writer, and films the reference
viewer beside a web recreation of the SwiftUI phone client — both folding the
same event log. Nothing is seeded into a UI; the harness only makes `/rpc`
calls, so if it works in the demo it works from an MCP host.

`node demo/demo.mjs` is the single entry point (`doctor`, `up`, `status`,
`play`, `record`, `down`). It encodes the ordering rules that are easy to get
wrong — the hub has to start before the viewer or it proxies the wrong app, the
viewer needs a pinned port, each surface is identity-checked by page title
before filming, and the writer is reset per run because the scenario reuses
fixed grant ids. Do not re-derive those by hand; use the CLI.

A scenario is a plain module exporting `chapters` (and optionally
`phoneSurface`), so a new demo is a new file plus `--scenario`, not an edit to
the recorder. The contract is in [`demo/README.md`](demo/README.md).

The phone is a **web recreation**, labelled as such on screen: `drive-ios` is
SwiftUI and cannot build without Xcode. `demo/ios/fold.js` is a 1:1 port of
`apply(wireEvent:)` from that repo's `WriterClient.swift`, so it is evidence the
wire carries what the phone needs — not evidence the Swift app builds. If the
fold there drifts from the Swift one, the demo stops being evidence of anything.

## Conventions

- **Bun-first**, ESM, TypeScript `strict`. Tabs, double quotes, semicolons.
- Exhaustive `switch` with a `never` default; imports at the top of the file only.
- Validate before appending. A pack payload that does not parse must throw
  rather than reach the log.
- The writer is the single room truth. MCP is a **façade** (`/rpc` + stdio
  proxy) — it must not accumulate its own state.
- Errors cross `/rpc` as `{ ok: false, error }` with HTTP 400; the stdio proxy
  turns that into an MCP `isError` result. Keep both paths.

## Hard rules

- **One writer per room.** Do not add a second authority or a client-side cache
  that can disagree with the log.
- **Tools append events, never HTML/UI blobs.** The stage is typed events; the
  viewer renders them.
- **No prompts, tool allowlists, API keys, endpoints, or model IDs through MCP.**
  Profiles carry appearance plus a sanitized runtime badge only.
- **Privacy-strict.** Conversation bodies stay in memory; no transcript or audio
  persistence without an explicit debug flag.
- **No magic ports as identity.** The HTTP port is ephemeral by default
  (`DRIVEMODE_HTTP_PORT` overrides). Always use the printed URL or
  `~/.drivemode/writer.json`. Never hardcode `:7891`.
- **Do not depend on `@cline/*`** and do not re-implement `reduceRoom`.

## Gotchas

- **Stale kernel copy.** `file:` installs a *snapshot*. After regenerating
  `cline-drivecode/sdk/dist-bundle/drive-kernel`, run `bun install --force` here
  before `bun test`.
- **Typecheck reads generated source.** `apps/writer/tsconfig.json` maps
  `@drive-mode/drive-kernel` at the sibling bundle's `src/index.ts`. Generate
  the bundle before typecheck.
- **The writer is in-memory.** It resets on restart; there is no SQLite log.
  Cross-restart durability is not a v0 goal. A restart is a *new* `logId` —
  clients detect it by comparison, so never carry a `logId` (or an `opId`
  memory) across store incarnations.
- `bun test` at the root runs `tests/` only. The viewer has no test suite —
  verify it with `bun run --cwd apps/viewer typecheck`.
- README examples show an ephemeral port placeholder; do not copy a literal port
  into code or docs.

## Non-goals (v0)

Multi-room, auth, a durable SQLite log, voice/WebRTC, and a Cline hub bridge are
deliberately out of scope. If a change needs one of these, raise it rather than
sneaking it in.

## Before you push

```bash
bun install --force   # if the sibling harness changed
bun run check         # typecheck + test + writer build
bun run --cwd apps/viewer typecheck
```
