import {
	createEmptyRoomSnapshot,
	reduceRoom,
	type DriveEvent,
	type LoggedEvent,
	type RoomSnapshot,
} from "@drive-mode/collaboration-harness";

export type WriterRoomState = {
	snapshot: RoomSnapshot;
	log: LoggedEvent[];
	nextSeq: number;
	activePackId: string;
	lastNarrationAtMs: number | null;
	/** Conversation bodies kept in memory only (privacy-strict). */
	conversationFeed: Array<{
		seq: number;
		at: string;
		actorId?: string;
		text: string;
		kind: "message" | "narration";
	}>;
};

export type WriterStore = {
	readonly roomId: string;
	getState(): WriterRoomState;
	append(event: DriveEvent): { seq: number; snapshot: RoomSnapshot; event: DriveEvent };
	eventsSince(sinceSeq: number): LoggedEvent[];
	setActivePack(packId: string): void;
	markNarration(atMs: number): void;
	subscribe(handler: (entry: LoggedEvent, snapshot: RoomSnapshot) => void): () => void;
};

export function createWriterStore(input?: {
	roomId?: string;
	activePackId?: string;
}): WriterStore {
	const roomId = input?.roomId ?? "default";
	const listeners = new Set<
		(entry: LoggedEvent, snapshot: RoomSnapshot) => void
	>();

	const state: WriterRoomState = {
		snapshot: createEmptyRoomSnapshot({
			roomId,
			createdAt: new Date().toISOString(),
		}),
		log: [],
		nextSeq: 0,
		activePackId: input?.activePackId ?? "coding",
		lastNarrationAtMs: null,
		conversationFeed: [],
	};

	return {
		roomId,
		getState() {
			return state;
		},
		append(event) {
			if (event.roomId !== roomId) {
				throw new Error(`Event room mismatch: ${event.roomId} !== ${roomId}`);
			}
			const seq = state.nextSeq;
			state.nextSeq += 1;
			const entry: LoggedEvent = { seq, event };
			state.log.push(entry);
			state.snapshot = reduceRoom(state.snapshot, event);

			if (
				event.type === "conversation.message" ||
				event.type === "conversation.narration"
			) {
				state.conversationFeed.push({
					seq,
					at: event.at,
					actorId: event.actorId,
					text: event.text,
					kind:
						event.type === "conversation.narration" ? "narration" : "message",
				});
				// Cap in-memory feed
				if (state.conversationFeed.length > 200) {
					state.conversationFeed.splice(0, state.conversationFeed.length - 200);
				}
			}

			for (const listener of listeners) {
				listener(entry, state.snapshot);
			}
			return { seq, snapshot: state.snapshot, event };
		},
		eventsSince(sinceSeq) {
			return state.log.filter((entry) => entry.seq > sinceSeq);
		},
		setActivePack(packId) {
			state.activePackId = packId;
		},
		markNarration(atMs) {
			state.lastNarrationAtMs = atMs;
		},
		subscribe(handler) {
			listeners.add(handler);
			return () => {
				listeners.delete(handler);
			};
		},
	};
}
