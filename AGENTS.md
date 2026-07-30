# AGENTS.md — drivemode-mcp

## Mission

Ship the **feeling** of live reacting agents on a shared Spotlight for any MCP host. Depend on `@drive-mode/collaboration-harness` for protocol/kernel. Do not re-implement `reduceRoom` here.

## Do

- Keep the writer the single room truth.
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
