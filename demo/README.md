# The end-to-end Drive Mode demo

A single narrative — a human steering four agents through one change — played
through **every client at once**, and recorded.

Everything on screen is produced by MCP tool calls against a running writer.
There are no fixtures, no seeded UI state and no scripted animation: the clients
render whatever the writer's append-only log says, and the log is built only by
the calls in `scenario.mjs`.

## What it shows

| Surface | What it is | Status |
|---|---|---|
| Reference viewer | `apps/viewer` — React + SSE | the real app, running |
| Drive for iPhone | `ios/` in this folder | **web recreation** — see below |
| Cline hub dashboard | `cline-drivecode` `apps/cline-hub` | the real app, running |

### About the iPhone surface

`drive-ios` is a SwiftUI app. Building or booting it needs Xcode and macOS, so
on Linux it cannot run at all. Rather than skip the phone, `ios/` is a web
recreation of the client:

- `ios/fold.js` is a deliberate 1:1 port of `apply(wireEvent:)` from
  `drive-ios/Sources/WriterClient.swift` — the same event names, guards, TTL
  arithmetic and working-set caps.
- It polls `POST /rpc { tool: "events_since" }` with a strictly-after cursor and
  resyncs from zero when `latestSeq` goes backwards, exactly as `pollWire()`
  does, on the same adaptive cadence tiers.
- Styling uses the `DT` tokens from `drive-ios/Sources/Theme.swift`.

It is labelled as a recreation on screen and in the video. It is evidence that
the wire carries what the phone needs; it is **not** evidence that the shipping
Swift app builds.

## Run it

Three processes. Read every URL from its own output — never hardcode a port.

```bash
# 1. the writer (in-memory, single room)
DRIVEMODE_HTTP_PORT=4600 bun run writer

# 2. the reference viewer
bun run viewer            # Vite picks a free port and prints it

# 3. the demo surfaces + a same-origin /rpc proxy
node demo/serve.mjs       # http://127.0.0.1:8080/ios/  and  /stage/
```

Then play the scenario:

```bash
node demo/run-scenario.mjs                  # the whole story
node demo/run-scenario.mjs --list           # the eleven chapter ids
node demo/run-scenario.mjs --chapter tests  # replay through `tests`, then stop
DEMO_PACE_MS=15 node demo/run-scenario.mjs  # as fast as the writer will take it
```

The phone supports the same swipe-between-surfaces gesture the app does, so the
recording can show it: a horizontal drag past ~55px moves one surface, and a
drag that is more vertical than horizontal is ignored so it cannot fire while a
long list is being scrolled.

`--chapter` replays **from the start through** the chapter you name — it does
not run that chapter alone. Chapters are not independent: `tests` transfers a
Presenter grant that `handoff` created, `handoff` transfers one that `presenter`
created, and every work event needs the roster `lobby` joined. Running a later
chapter against an empty room fails on the first call that references a grant or
participant nobody has created yet.

Always start from a fresh writer. Replaying onto a writer that already holds a
completed run reuses spent grant ids, and the Presenter guard correctly rejects
them.

Point the viewer at the writer with `?writer=http://127.0.0.1:4600` — its
built-in default is port 8787, which the Cline hub dashboard also wants.

## Record the video

Recording needs **Playwright** and a **full ffmpeg** — Playwright bundles a
VP8-only build that cannot write MP4. Neither is a dependency of this repo;
install them where you record:

```bash
npm i -g playwright && npx playwright install chromium
apt-get install -y ffmpeg          # or your platform's equivalent
```

```bash
node demo/record.mjs      # restarts the writer, records both segments
```

It writes two WebM files. `ffmpeg` (a full build, not Playwright's VP8-only
one) turns them into a single MP4 — see `make-video.sh`.

Pass the URLs the apps actually printed:

```bash
DEMO_VIEWER_URL=http://127.0.0.1:5173/ \
DEMO_HUB_URL=http://127.0.0.1:8787/ \
node demo/record.mjs
```

The recorder checks both are the app it expects before filming, by reading the
page title. Vite takes whatever port is free, so "the viewer" and "the hub
webview" trade places between runs — this pane has already filmed the hub
dashboard once while captioned as the reference viewer. A three-minute
recording of the wrong app looks completely fine, so the check is worth the
second it costs.

### Seeing the input

Screen recordings do not capture the OS cursor, and a browser draws nothing at
all for touch — so without help a viewer sees panels changing with no idea what
was pressed. `pointer.js` draws the input on top of the page: an arrow for the
desktop panes, an Apple-style touch ring for the phone, a ripple on press, and a
fading trail on swipe. The stage loads it with a script tag; the recorder
injects the same file into the hub dashboard, which the demo does not own. It
lives in a shadow root and never takes pointer events, so it cannot restyle or
intercept anything on the page underneath.

It is a *readout*, not a stand-in. `pointer-driver.mjs` moves the overlay and
dispatches the real Playwright input to the same coordinates in one call, so
every tap, click and swipe you see on video actually happened — the phone's
surfaces are reached by pressing its tab bar and by swiping the deck, not by
calling into the page.

## The scenario

Eleven chapters, chosen to cover every MCP primitive and all five packs.

| Chapter | Covers |
|---|---|
| `lobby` | `room_join`, `roster_set_profile` |
| `session` | `mode_set`, `session_create` / `_schedule` / `_start` |
| `presenter` | `title_grant`, `stage_set_sharer` |
| `taskgraph` | tasks pack — identity, state, dependency edges |
| `coding` | coding pack — plan, decision, edit, command |
| `interrupt` | `interrupt_raise`, `interrupt_ack` |
| `handoff` | `address_set`, `title_transfer` (atomic) |
| `tests` | coding pack test results — one red, one fix, one green |
| `artifacts` | artifacts pack — permanent vs TTL, superseded, archived |
| `ops` | demo-ops pack, `room_invite` — a different pack, same stage |
| `close` | `title_revoke`, `session_end` |

Direction beats (`direction` pack) are published throughout; they are what the
phone's Spotlight renders as a replayable program.

### Presenter is enforced, not decorative

The scenario cannot cheat the Presenter rule. `stage_set_sharer` for an agent is
rejected outright unless that agent holds an **active** grant, so the title has
to be chained through the fleet — granted to Atlas, then transferred Atlas →
Beacon → Cinder → Delta, then revoked. An early draft of this scenario tried to
put an agent on the stage without a grant and the writer refused it.

## Four bugs this demo surfaced

All were found by running the real clients against the real writer. The fixes
themselves live in a separate change against `apps/writer` and `apps/viewer` —
this folder adds no product code — but they are recorded here because the demo
is what surfaced them, and because the demo does not work without them.

1. **The reference viewer could not reach its own writer.** The writer sent no
   CORS headers, and the viewer is a browser app documented to be pointed at the
   writer by URL — so every fetch was a blocked cross-origin request and the
   viewer sat empty forever. `apps/writer/src/http.ts` now answers preflights
   and sets the headers on every response.

2. **The SSE `hello` message had a different shape than every message after
   it.** `hello` carried the `/snapshot` envelope (`{ seq, room, … }`) while the
   per-event messages carried a bare `RoomSnapshot`. The viewer assigned both to
   the same state, so the first message crashed it with
   `Cannot read properties of undefined (reading 'find')`. `hello` now sends
   `.room`, matching the stream's own contract.

3. **Every SSE stream died after about ten seconds of quiet.** The server closes
   a connection that carries no traffic, and the writer sent nothing between
   events — so a viewer left open on a quiet room lost its stream and
   reconnected in a loop. Measured before the fix: an idle stream was torn down
   at 12s. `/events` now sends a `: ping` comment every 5s, which EventSource
   ignores, so it keeps the connection warm without ever reaching `onmessage`.
   The same stream now survives indefinitely.

4. **A dead SSE stream could fail an unrelated write.** `store.append` fans out
   to subscribers *after* it has already pushed the entry and folded the
   snapshot, and it did so with no guard. A closed stream's `enqueue` throws, so
   one abandoned viewer could make a later `append` report failure for a write
   that had in fact landed — and every subscriber after it in the set silently
   missed that event. A throwing subscriber is now dropped and the append
   carries on, and the stream itself has one idempotent teardown that
   unsubscribes rather than only clearing its heartbeat.

A fifth, smaller fix: the viewer left a stale "SSE disconnected" banner up
after the stream recovered, because nothing cleared the error when messages
resumed.
