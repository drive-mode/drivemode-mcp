import type { RoomService } from "./roomService.js";
import { listPackIds } from "./roomService.js";
import type { WriterStore } from "./store.js";

export type HttpWriterOptions = {
	store: WriterStore;
	service: RoomService;
	port?: number;
	host?: string;
};

type RpcBody = {
	tool: string;
	args?: Record<string, unknown>;
};

async function dispatchRpc(
	service: RoomService,
	tool: string,
	args: Record<string, unknown>,
): Promise<unknown> {
	switch (tool) {
		case "room_join": {
			const kind = String(args.kind ?? "agent");
			const id = String(args.id);
			const displayName = String(args.displayName);
			const participant =
				kind === "human"
					? {
							id,
							kind: "human" as const,
							displayName,
							role: (String(args.role ?? "participant") as
								| "host"
								| "participant"
								| "observer"),
							status: "idle" as const,
						}
					: {
							id,
							kind: "agent" as const,
							displayName,
							role: (String(args.role ?? "partner") as
								| "partner"
								| "specialist"
								| "recorder"),
							status: "idle" as const,
							seatSources: [{ kind: "manual" as const }],
						};
			const result = service.join(participant, args.actorId as string | undefined);
			return { seq: result.seq, room: result.snapshot };
		}
		case "room_leave": {
			const result = service.leave(
				String(args.participantId),
				args.reason as string | undefined,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "room_snapshot":
			return service.snapshot();
		case "roster_list": {
			const snap = service.snapshot();
			return { participants: snap.room.participants, seq: snap.seq };
		}
		case "roster_set_profile": {
			const result = service.setProfile(
				String(args.participantId),
				{
					displayName: args.displayName as string | undefined,
					ink: args.ink as string | undefined,
				},
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "address_set": {
			const mode = String(args.mode ?? "everyone");
			const addressSet =
				mode === "everyone"
					? { mode: "everyone" as const }
					: mode === "agents"
						? {
								mode: "agents" as const,
								agentIds: (args.agentIds as string[]) ?? [],
							}
						: {
								mode: "pack" as const,
								packId: String(args.packId ?? ""),
							};
			const result = service.setAddress(
				addressSet,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "stage_publish_work": {
			const result = service.publishWork({
				packId: args.packId as string | undefined,
				type: String(args.type),
				payload: (args.payload as Record<string, unknown>) ?? {},
				actorId: args.actorId as string | undefined,
				narrate: args.narrate as boolean | undefined,
			});
			return {
				seq: result.seq,
				event: result.event,
				spotlight: result.snapshot.stage,
			};
		}
		case "stage_set_sharer": {
			const participantId = args.participantId as string | null;
			const sharer =
				participantId == null
					? null
					: {
							kind: (String(args.kind ?? "agent") as "human" | "agent"),
							participantId,
						};
			const result = service.setSharer(
				sharer,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "mode_set": {
			const result = service.setMode(
				args.subMode as "plan" | "act" | "ask" | "debug",
				args.driveActive as boolean | undefined,
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "mode_get":
			return service.getMode();
		case "interrupt_raise": {
			const result = service.raiseHand(
				String(args.participantId),
				Boolean(args.raised ?? true),
				args.actorId as string | undefined,
			);
			return { seq: result.seq, room: result.snapshot };
		}
		case "interrupt_ack": {
			const result = service.interruptAck(
				String(args.participantId),
				{
					intent: args.intent as
						| "stop"
						| "clarify"
						| "redirect"
						| "fresh"
						| undefined,
					gist: args.gist as string | undefined,
					turnInFlight: args.turnInFlight as boolean | undefined,
					hardCancel: args.hardCancel as boolean | undefined,
				},
				args.actorId as string | undefined,
			);
			return { seq: result.seq, event: result.event };
		}
		case "conversation_publish": {
			const result = service.publishConversation(
				String(args.text),
				args.actorId as string | undefined,
			);
			return { seq: result.seq, event: result.event };
		}
		case "events_since": {
			const sinceSeq = Number(args.sinceSeq ?? 0);
			const events = service.eventsSince(sinceSeq);
			const snap = service.snapshot();
			return { sinceSeq, latestSeq: snap.seq, events };
		}
		case "pack_set":
			return service.setActivePack(String(args.packId));
		case "pack_list":
			return { packs: listPackIds() };
		default:
			throw new Error(`Unknown tool: ${tool}`);
	}
}

/**
 * Viewer HTTP surface + JSON-RPC bridge so MCP stdio can share the same writer.
 */
export async function startHttpWriter(
	options: HttpWriterOptions,
): Promise<{ server: { port: number | undefined; stop: (closeActive?: boolean) => void }; port: number; url: string }> {
	const preferred = options.port ?? Number(process.env.DRIVEMODE_HTTP_PORT ?? 0);
	const host = options.host ?? "127.0.0.1";

	const tryListen = (port: number) =>
		Bun.serve({
			hostname: host,
			port,
			async fetch(req) {
				const url = new URL(req.url);

				if (url.pathname === "/health") {
					return Response.json({ ok: true, roomId: options.store.roomId });
				}

				if (url.pathname === "/snapshot") {
					return Response.json(options.service.snapshot());
				}

				if (url.pathname === "/rpc" && req.method === "POST") {
					try {
						const body = (await req.json()) as RpcBody;
						const result = await dispatchRpc(
							options.service,
							body.tool,
							body.args ?? {},
						);
						return Response.json({ ok: true, result });
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						return Response.json(
							{ ok: false, error: message },
							{ status: 400 },
						);
					}
				}

				if (url.pathname === "/events") {
					const sinceSeq = Number(url.searchParams.get("since") ?? "0");
					const backlog = options.service.eventsSince(
						Number.isFinite(sinceSeq) ? sinceSeq : 0,
					);

					let unsubscribe: (() => void) | null = null;
					const stream = new ReadableStream({
						start(controller) {
							const encoder = new TextEncoder();
							const send = (payload: unknown) => {
								controller.enqueue(
									encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
								);
							};
							send({
								type: "hello",
								roomId: options.store.roomId,
								snapshot: options.service.snapshot(),
								backlog,
							});
							unsubscribe = options.store.subscribe((entry, snapshot) => {
								send({ type: "event", entry, snapshot });
							});
						},
						cancel() {
							unsubscribe?.();
						},
					});

					return new Response(stream, {
						headers: {
							"Content-Type": "text/event-stream",
							"Cache-Control": "no-cache",
							Connection: "keep-alive",
							"Access-Control-Allow-Origin": "*",
						},
					});
				}

				if (url.pathname === "/api/raise-hand" && req.method === "POST") {
					const body = (await req.json()) as {
						participantId?: string;
						raised?: boolean;
					};
					const participantId = body.participantId ?? "drive:human";
					const raised = body.raised ?? true;
					const result = options.service.raiseHand(participantId, raised);
					return Response.json({ seq: result.seq, room: result.snapshot });
				}

				if (url.pathname === "/" || url.pathname === "/index.html") {
					return new Response(
						`drivemode writer · room=${options.store.roomId}\n` +
							`GET /snapshot  GET /events?since=0  POST /rpc  POST /api/raise-hand\n`,
						{ headers: { "Content-Type": "text/plain" } },
					);
				}

				return new Response("Not found", { status: 404 });
			},
		});

	let server: { port: number | undefined; stop: (closeActive?: boolean) => void };
	try {
		server = tryListen(preferred);
	} catch {
		server = tryListen(0);
	}

	const url = `http://${host}:${server.port}`;
	return { server, port: server.port ?? 0, url };
}

export { dispatchRpc };
