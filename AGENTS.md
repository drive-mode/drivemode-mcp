# AGENTS.md — drivemode-mcp

## Mission

Ship the **feeling** of live reacting agents on a shared Spotlight for any MCP host. Depend on `@drive-mode/drive-kernel` for protocol/kernel. Do not re-implement `reduceRoom` here.

## Do

- Keep the writer the single room truth **in the no-Hub profile**. When a Cline Hub is live for the same room, Hub wins (cline-drivecode ADR-0057).
- Validate pack payloads before appending work events.
- Prefer ephemeral ports + printed URLs / `~/.drivemode/writer.json`.
- Exhaustive switches with `never`; imports at top of file.

## Do not

- Depend on `@cline/*`.
- Open PRs against `cline-drivecode` for this product.
- Hardcode `:7891` or other magic ports as identity.
- Accept prompts, API keys, or model IDs via MCP tools.
- Persist transcripts/audio without an explicit debug flag.

## Verify

```bash
bun test
```

To see it rather than test it: `node demo/demo.mjs record` films the whole
thing. `node demo/demo.mjs doctor` says what is missing first. Details in
`demo/README.md`.

The kernel dependency is `file:../../../cline-drivecode/sdk/dist-bundle/drive-kernel`.
Generate it with `bun run build:drive-kernel` in the Cline clone. After regenerating
the bundle, run `bun install --force` here before `bun test`. Typecheck resolves
kernel types from that generated tree (`apps/writer/tsconfig.json` paths).
