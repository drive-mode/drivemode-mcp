import { describe, expect, test } from "bun:test";
import { createRoomService } from "../apps/writer/src/roomService.ts";
import { createWriterStore } from "../apps/writer/src/store.ts";
import { validateTasksWork } from "../packages/packs-tasks/src/index.ts";
import { validateArtifactsWork } from "../packages/packs-artifacts/src/index.ts";
import { validateDirectionWork } from "../packages/packs-direction/src/index.ts";

describe("fleet packs — validation", () => {
	test("tasks pack accepts created with deps", () => {
		const v = validateTasksWork("work.task.created", {
			taskId: "t1",
			title: "Gate JWT refresh",
			project: "Auth middleware",
			state: "running",
			deps: ["t2"],
		});
		expect(v.type).toBe("work.task.created");
		if (v.type === "work.task.created") {
			expect(v.payload.deps).toEqual(["t2"]);
		}
	});

	test("tasks pack rejects out-of-range progress", () => {
		expect(() =>
			validateTasksWork("work.task.progress", { taskId: "t1", progress: 1.2 }),
		).toThrow();
	});

	test("artifacts pack accepts ephemeral ttl life", () => {
		const v = validateArtifactsWork("work.artifact.created", {
			artifactId: "a1",
			title: "Staging config capture",
			kind: "capture",
			life: { ttlDays: 7 },
			sizeKb: 980,
		});
		expect(v.type).toBe("work.artifact.created");
	});

	test("artifacts pack rejects a life that is both permanent and ttl", () => {
		expect(() =>
			validateArtifactsWork("work.artifact.created", {
				artifactId: "a1",
				title: "x",
				kind: "doc",
				life: { permanent: true, ttlDays: 7 },
			}),
		).toThrow();
	});

	test("direction pack accepts a beat annotation", () => {
		const v = validateDirectionWork("work.direction.beat", {
			programId: "auth-session-1",
			beatIndex: 1,
			kind: "diagram",
			title: "Request path",
			caption: "Every refresh now passes through verifyJwt.",
		});
		expect(v.type).toBe("work.direction.beat");
	});
});

describe("fleet packs — writer mapping", () => {
	test("task/artifact/beat publishes land as timestamped work.generic events", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);

		service.publishWork({
			packId: "tasks",
			type: "work.task.created",
			payload: {
				taskId: "t1",
				title: "Gate JWT refresh",
				project: "Auth middleware",
				state: "running",
				deps: ["t2"],
			},
			narrate: false,
		});
		service.publishWork({
			packId: "artifacts",
			type: "work.artifact.created",
			payload: {
				artifactId: "a1",
				title: "Room replay",
				kind: "replay",
				life: { ttlDays: 30 },
				sizeKb: 4300,
			},
			narrate: false,
		});
		service.publishWork({
			packId: "direction",
			type: "work.direction.beat",
			payload: {
				programId: "auth-session-1",
				beatIndex: 0,
				kind: "plan",
				title: "Ship auth middleware",
				directorId: "maya",
			},
			narrate: false,
		});

		const events = store
			.eventsSince(-1)
			.map((entry) => entry.event)
			.filter((event) => event.type === "work.generic");
		expect(events.length).toBe(3);

		const [task, artifact, beat] = events;
		expect(task.kind).toBe("work.task.created");
		expect(task.summary).toContain("Auth middleware");
		expect((task.payload as { deps: string[] }).deps).toEqual(["t2"]);

		expect(artifact.kind).toBe("work.artifact.created");
		expect(artifact.summary).toContain("30d ttl");

		expect(beat.kind).toBe("work.direction.beat");
		expect(beat.summary).toContain("beat 1");

		// Ask 1 from DATA-NEEDS: every event carries wall-clock time.
		for (const event of events) {
			expect(Date.parse(event.at)).toBeGreaterThan(0);
		}
	});

	test("unknown pack kinds are rejected", () => {
		const store = createWriterStore({ roomId: "default" });
		const service = createRoomService(store);
		expect(() =>
			service.publishWork({
				packId: "tasks",
				type: "work.task.rename",
				payload: { taskId: "t1" },
				narrate: false,
			}),
		).toThrow();
	});
});
