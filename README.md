# Drive Mode MCP

**Agent → stage write path** for live multi-agent presence with visuals. Built on generated [`@drive-mode/drive-kernel`](https://github.com/drive-mode/cline-drivecode) (canonical fold is `@cline/drive`).

Five primitives: **presence · spotlight · narration · interrupt · address**.

```text
Agent host(s) --MCP tools--> Writer (single) --events/seq--> Viewer(s)
                                  |
                           packs validate work payloads
```

## Install

Clone **as a sibling** of `cline-drivecode` and generate the kernel bundle:

```bash
drive-mode/
  cline-drivecode/   # bun run build:sdk && bun run build:drive-kernel
  drivemode-mcp/     ← you are here
```

```bash
bun install
```

The writer depends on `file:../../../cline-drivecode/sdk/dist-bundle/drive-kernel`.
Published coordinate (GitHub Packages): `@drive-mode/drive-kernel`. Do not import `@cline/*`.

## Run

```bash
# Terminal 1 — single room writer (prints live URLs; port is ephemeral)
bun run writer

# Terminal 2 — viewer
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun run viewer
# open the Vite URL, paste the writer URL into the field (or ?writer=...)

# Terminal 3 — MCP stdio for Cursor / Claude Desktop
DRIVEMODE_WRITER_URL=http://127.0.0.1:<printed-port> bun run --cwd apps/writer mcp
```

Sample MCP configs: [`examples/cursor-mcp.json`](examples/cursor-mcp.json), [`examples/claude-desktop.json`](examples/claude-desktop.json).

Discovery file (written on writer start): `~/.drivemode/writer.json`
(`url`, `port`, `roomId`, `logId`, `pid`, `startedAt`).

## Demos

`demo/` drives a scripted multi-agent session through every MCP primitive and
all five packs, and films the reference viewer and an iPhone client folding the
same event log side by side. One entry point:

```bash
node demo/demo.mjs doctor    # what is missing before you can record
node demo/demo.mjs record    # start the stack, film it, encode an MP4
node demo/demo.mjs down      # stop everything it started
```

It starts the services in the order that actually works, pins the ports that
otherwise collide, identity-checks each surface before filming, and resets the
writer so a run is repeatable. `--scenario ./my-story.mjs` films a different
story with the same rig. Full guide, including how to write a new scenario:
[`demo/README.md`](demo/README.md).

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

### Wire contract: resume, restarts, retries

- `seq` is the resume cursor, and `logId` names the log incarnation that
  issued it. The in-memory writer restarts as a *different* log whose `seq`
  also starts at 1, so clients compare the `logId` on `/health`, `/snapshot`,
  `events_since`, and the SSE `hello`, and resync from the top when it
  changes — `latestSeq < cursor` alone misses a fresh log that has already
  grown past the old cursor.
- SSE messages carry `id: <logId>:<seq>`; on auto-reconnect the writer honors
  `Last-Event-ID` so the stream resumes at the true cursor instead of
  replaying the connect-time backlog. Consumers that stop reading are shed
  once their unread queue passes a bound — safe, because the replayable log
  lets them reconnect and resume.
- `stage_publish_work` and `conversation_publish` accept an optional `opId`
  retry key: replaying the same `opId` returns the recorded result instead of
  appending a visible duplicate.

The reasoning is recorded in [`docs/DDIA-LESSONS.md`](docs/DDIA-LESSONS.md).

## Packs

- `coding` — `work.edit`, `work.command`, `work.test`, `work.plan`, `work.decision`, `work.generic`
- `tasks` — `work.task.created`, `work.task.state`, `work.task.progress` (identity, state, dependency edges)
- `artifacts` — `work.artifact.created`, `work.artifact.lifecycle`, `work.artifact.superseded`
- `direction` — `work.direction.beat` (choreography a phone can digest)
- `demo-ops` — `work.ops.alert`, `work.ops.runbook_step` (proves non-coding use cases)

Fleet packs ride `work.generic`; the kernel never special-cases one.

## Hard rules

- One writer per room. MCP is a façade (`/rpc` + stdio proxy).
- Tools append **events**, never HTML/UI blobs.
- No prompts, tool allowlists, API keys, endpoints, or model IDs in MCP.
- Privacy-strict: conversation bodies stay in-memory; no transcript/audio persistence by default.
- Do **not** hardcode a magic port as identity. Use the printed URL / discovery file.

## Layout

```text
apps/writer/       # HTTP writer + MCP stdio proxy
apps/viewer/       # React call-feel UI (roster + Spotlight + feed)
packages/packs-*/  # coding, tasks, artifacts, direction, demo-ops
demo/              # the end-to-end demo + recorder (see demo/README.md)
docs/              # DDIA-LESSONS.md — why the wire is shaped like this
tests/             # bun:test suite
examples/          # MCP host configs
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
