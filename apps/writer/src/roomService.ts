import {
	allowNarrationByRate,
	classifyInterrupt,
	narrate,
	type AddressSet,
	type DriveEvent,
	type DriveSubMode,
	type Participant,
	type StageSharer,
} from "@drive-mode/collaboration-harness";
import { codingPack } from "@drivemode/packs-coding";
import { demoOpsPack } from "@drivemode/packs-demo-ops";
import type { WriterStore } from "./store.js";

let eventCounter = 0;
function mintId(prefix: string): string {
	eventCounter += 1;
	return `${prefix}_${Date.now().toString(36)}_${eventCounter.toString(36)}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

const packs = {
	[codingPack.id]: codingPack,
	[demoOpsPack.id]: demoOpsPack,
} as const;

export type PackId = keyof typeof packs;

export function listPackIds(): PackId[] {
	return Object.keys(packs) as PackId[];
}

export function createRoomService(store: WriterStore) {
	function base(actorId?: string) {
		return {
			schemaVersion: 1 as const,
			id: mintId("evt"),
			roomId: store.roomId,
			at: nowIso(),
			actorId,
		};
	}

	return {
		snapshot() {
			const state = store.getState();
			return {
				seq: Math.max(0, state.nextSeq - 1),
				room: state.snapshot,
				activePackId: state.activePackId,
				conversationFeed: state.conversationFeed,
			};
		},

		eventsSince(sinceSeq: number) {
			return store.eventsSince(sinceSeq);
		},

		join(participant: Participant, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.join",
				track: "control",
				participant,
			});
		},

		leave(participantId: string, reason?: string, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.leave",
				track: "control",
				participantId,
				reason,
			});
		},

		setAddress(addressSet: AddressSet, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.address",
				track: "control",
				addressSet,
			});
		},

		setSharer(sharer: StageSharer | null, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.stage",
				track: "control",
				sharer,
			});
		},

		setMode(subMode: DriveSubMode, driveActive?: boolean, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.mode",
				track: "control",
				subMode,
				driveActive,
			});
		},

		getMode() {
			const { snapshot } = store.getState();
			return {
				subMode: snapshot.subMode,
				driveActive: snapshot.driveActive,
			};
		},

		raiseHand(participantId: string, raised: boolean, actorId?: string) {
			return store.append({
				...base(actorId),
				type: "control.raise_hand",
				track: "control",
				participantId,
				raised,
			});
		},

		interruptAck(
			participantId: string,
			input: {
				intent?: "stop" | "clarify" | "redirect" | "fresh";
				gist?: string;
				turnInFlight?: boolean;
				hardCancel?: boolean;
			},
			actorId?: string,
		) {
			const classification = classifyInterrupt({
				intent: input.intent,
				gist: input.gist,
				turnInFlight: input.turnInFlight ?? true,
				hardCancel: input.hardCancel,
			});
			return store.append({
				...base(actorId),
				type: "control.interrupt_ack",
				track: "control",
				participantId,
				action: classification.action,
				revise: classification.revise,
			});
		},

		setProfile(
			participantId: string,
			profile: { displayName?: string; ink?: string },
			actorId?: string,
		) {
			const results = [];
			if (profile.displayName) {
				results.push(
					store.append({
						...base(actorId),
						type: "control.rename",
						track: "control",
						participantId,
						displayName: profile.displayName,
					}),
				);
			}
			const state = store.getState();
			const nextProfiles = {
				...state.snapshot.profilesByParticipantId,
				[participantId]: {
					participantId,
					displayName:
						profile.displayName ??
						state.snapshot.profilesByParticipantId[participantId]?.displayName,
					ink:
						profile.ink ??
						state.snapshot.profilesByParticipantId[participantId]?.ink,
				},
			};
			state.snapshot = {
				...state.snapshot,
				profilesByParticipantId: nextProfiles,
			};
			return results.at(-1) ?? {
				seq: Math.max(0, state.nextSeq - 1),
				snapshot: state.snapshot,
				event: null as DriveEvent | null,
			};
		},

		setActivePack(packId: string) {
			if (!(packId in packs)) {
				throw new Error(
					`Unknown pack: ${packId}. Known: ${listPackIds().join(", ")}`,
				);
			}
			store.setActivePack(packId);
			return { activePackId: packId };
		},

		publishWork(input: {
			packId?: string;
			type: string;
			payload: unknown;
			actorId?: string;
			narrate?: boolean;
		}) {
			const packId = input.packId ?? store.getState().activePackId;
			const pack = packs[packId as PackId];
			if (!pack) {
				throw new Error(`Unknown pack: ${packId}`);
			}

			const validated = pack.validate(input.type, input.payload);
			let event: DriveEvent;

			if (packId === "coding") {
				const coding = validated as ReturnType<typeof codingPack.validate>;
				switch (coding.type) {
					case "work.edit":
						event = {
							...base(input.actorId),
							type: "work.edit",
							track: "work",
							packId,
							...coding.payload,
						};
						break;
					case "work.command":
						event = {
							...base(input.actorId),
							type: "work.command",
							track: "work",
							packId,
							...coding.payload,
						};
						break;
					case "work.test":
						event = {
							...base(input.actorId),
							type: "work.test",
							track: "work",
							packId,
							...coding.payload,
						};
						break;
					case "work.plan":
						event = {
							...base(input.actorId),
							type: "work.plan",
							track: "work",
							packId,
							...coding.payload,
						};
						break;
					case "work.decision":
						event = {
							...base(input.actorId),
							type: "work.decision",
							track: "work",
							packId,
							...coding.payload,
						};
						break;
					case "work.generic":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							...coding.payload,
						};
						break;
					default: {
						const _exhaustive: never = coding;
						return _exhaustive;
					}
				}
			} else {
				const ops = validated as ReturnType<typeof demoOpsPack.validate>;
				switch (ops.type) {
					case "work.ops.alert":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: ops.type,
							title: ops.payload.title,
							summary:
								ops.payload.summary ??
								`${ops.payload.severity}${ops.payload.service ? ` · ${ops.payload.service}` : ""}`,
							payload: ops.payload,
						};
						break;
					case "work.ops.runbook_step":
						event = {
							...base(input.actorId),
							type: "work.generic",
							track: "work",
							packId,
							kind: ops.type,
							title: ops.payload.title,
							summary: ops.payload.summary ?? `${ops.payload.step} (${ops.payload.status})`,
							payload: ops.payload,
						};
						break;
					default: {
						const _exhaustive: never = ops;
						return _exhaustive;
					}
				}
			}

			const result = store.append(event);

			if (input.narrate !== false) {
				const state = store.getState();
				const nowMs = Date.now();
				if (allowNarrationByRate(state.lastNarrationAtMs, nowMs)) {
					const candidate = narrate(event, "decision-points");
					if (candidate) {
						store.markNarration(nowMs);
						store.append({
							...base(input.actorId),
							type: "conversation.narration",
							track: "conversation",
							text: candidate.text,
							relatedWorkEventId: candidate.relatedWorkEventId,
						});
					}
				}
			}

			return result;
		},

		publishConversation(text: string, actorId?: string) {
			const trimmed = text.trim();
			if (!trimmed) {
				throw new Error("conversation text must be non-empty");
			}
			if (trimmed.length > 500) {
				throw new Error("conversation text capped at 500 chars (density)");
			}
			return store.append({
				...base(actorId),
				type: "conversation.message",
				track: "conversation",
				text: trimmed,
			});
		},
	};
}

export type RoomService = ReturnType<typeof createRoomService>;
