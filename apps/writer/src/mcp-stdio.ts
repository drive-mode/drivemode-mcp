import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * Stdio MCP façade that proxies tool calls to a running writer HTTP `/rpc`.
 * Set DRIVEMODE_WRITER_URL (printed by `bun run writer`).
 */

const writerUrl = (
	process.env.DRIVEMODE_WRITER_URL ?? "http://127.0.0.1:0"
).replace(/\/$/, "");

async function rpc(tool: string, args: Record<string, unknown> = {}) {
	const res = await fetch(`${writerUrl}/rpc`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ tool, args }),
	});
	const body = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
	if (!body.ok) {
		throw new Error(body.error ?? `RPC failed for ${tool}`);
	}
	return body.result;
}

function jsonResult(data: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
	};
}

function errorResult(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
		isError: true as const,
	};
}

function tool(
	server: McpServer,
	name: string,
	description: string,
	schema: Record<string, z.ZodTypeAny>,
) {
	server.tool(name, description, schema, async (args) => {
		try {
			return jsonResult(await rpc(name, args as Record<string, unknown>));
		} catch (error) {
			return errorResult(error);
		}
	});
}

async function main() {
	if (!process.env.DRIVEMODE_WRITER_URL) {
		console.error(
			"[drivemode-mcp] DRIVEMODE_WRITER_URL is required (start the writer first).",
		);
		process.exit(1);
	}

	const health = await fetch(`${writerUrl}/health`).catch(() => null);
	if (!health?.ok) {
		console.error(`[drivemode-mcp] Writer not reachable at ${writerUrl}`);
		process.exit(1);
	}

	const server = new McpServer({
		name: "drivemode-mcp",
		version: "0.1.0",
	});

	tool(server, "room_join", "Seat a human or agent participant.", {
		id: z.string().min(1),
		kind: z.enum(["human", "agent"]),
		displayName: z.string().min(1),
		role: z.string().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "room_leave", "Remove a participant.", {
		participantId: z.string().min(1),
		reason: z.string().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "room_snapshot", "Current room snapshot + seq.", {});
	tool(server, "roster_list", "List participants.", {});
	tool(server, "roster_set_profile", "Appearance overlay only.", {
		participantId: z.string().min(1),
		displayName: z.string().optional(),
		ink: z.string().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "address_set", "Set address scope.", {
		mode: z.enum(["everyone", "agents", "pack"]),
		agentIds: z.array(z.string()).optional(),
		packId: z.string().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "stage_publish_work", "Publish pack-validated work to Spotlight.", {
		packId: z.string().optional(),
		type: z.string().min(1),
		payload: z.record(z.unknown()),
		actorId: z.string().optional(),
		narrate: z.boolean().optional(),
	});
	tool(server, "stage_set_sharer", "Point Spotlight at a participant.", {
		participantId: z.string().nullable(),
		kind: z.enum(["human", "agent"]).optional(),
		actorId: z.string().optional(),
	});
	tool(server, "mode_set", "Set soft mode.", {
		subMode: z.enum(["plan", "act", "ask", "debug"]),
		driveActive: z.boolean().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "mode_get", "Get soft mode.", {});
	tool(server, "interrupt_raise", "Raise or lower hand.", {
		participantId: z.string().min(1),
		raised: z.boolean().default(true),
		actorId: z.string().optional(),
	});
	tool(server, "interrupt_ack", "Acknowledge interrupt.", {
		participantId: z.string().min(1),
		intent: z.enum(["stop", "clarify", "redirect", "fresh"]).optional(),
		gist: z.string().optional(),
		turnInFlight: z.boolean().optional(),
		hardCancel: z.boolean().optional(),
		actorId: z.string().optional(),
	});
	tool(server, "conversation_publish", "Short conversation / narration.", {
		text: z.string().min(1).max(500),
		actorId: z.string().optional(),
	});
	tool(server, "events_since", "Resume from seq.", {
		sinceSeq: z.number().int().nonnegative().default(0),
	});
	tool(server, "pack_set", "Switch active pack.", {
		packId: z.enum(["coding", "demo-ops"]),
	});
	tool(server, "pack_list", "List packs.", {});

	const transport = new StdioServerTransport();
	await server.connect(transport);
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
