/**
 * Records the end-to-end demo.
 *
 * Two segments, recorded as two Playwright contexts and joined afterwards:
 *
 *   1. "Two clients, one writer" — the reference viewer and the iPhone client
 *      side by side while the scenario plays. Captions name the chapter; the
 *      phone is switched to whichever surface that chapter is about.
 *   2. "The hub dashboard" — a tour of the Drive surfaces in the Cline hub.
 *
 * Nothing is scripted into the UIs. The recorder only makes MCP calls and
 * changes which tab is on screen; every value that appears is the clients
 * folding the writer's log.
 */

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

import { chapters } from "./scenario.mjs";
import { startWriter } from "./writer-lifecycle.mjs";

const OUT = process.env.DEMO_OUT ?? "/tmp/drivemode-demo/recording";
const VIEWER = process.env.DEMO_VIEWER_URL ?? "http://127.0.0.1:5174/";
const STAGE = process.env.DEMO_STAGE_URL ?? "http://127.0.0.1:8080/stage/";
const HUB = process.env.DEMO_HUB_URL ?? "http://127.0.0.1:8787/";
const SIZE = { width: 1600, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Which phone surface each chapter is really about. */
const PHONE_SURFACE = {
	lobby: "agents",
	session: "activity",
	presenter: "spotlight",
	taskgraph: "work",
	coding: "spotlight",
	interrupt: "activity",
	handoff: "spotlight",
	tests: "spotlight",
	artifacts: "artifacts",
	ops: "spotlight",
	close: "activity",
};

async function recordScenario() {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({
		viewport: SIZE,
		recordVideo: { dir: join(OUT, "raw-scenario"), size: SIZE },
	});
	const page = await ctx.newPage();

	const stageUrl = `${STAGE}?viewer=${encodeURIComponent(`${VIEWER}?writer=http://127.0.0.1:4600`)}`;
	// `networkidle` never fires here — the viewer holds an SSE stream open.
	await page.goto(stageUrl, { waitUntil: "load" });
	await sleep(4000);

	await page.evaluate(() =>
		window.setChapter(
			"the setup",
			"One writer. Many clients.",
			"A browser viewer and an iPhone client, both folding the same append-only event log. The log is empty right now.",
		),
	);
	await sleep(4500);

	let n = 0;
	for (const chapter of chapters) {
		n += 1;
		await page.evaluate(
			([num, title, blurb]) => window.setChapter(num, title, blurb),
			[`chapter ${n} of ${chapters.length}`, chapter.title, chapter.blurb],
		);
		const surface = PHONE_SURFACE[chapter.id];
		if (surface) {
			await page.evaluate((s) => window.showSurface(s), surface).catch(() => {});
		}
		await sleep(1600);
		await chapter.run();
		await sleep(2200);
	}

	// Close on the phone walking its own surfaces — the same log, five ways.
	await page.evaluate(() =>
		window.setChapter(
			"the phone",
			"Every surface, same log",
			"Spotlight, Work, Artifacts, Agents, Activity — all reconstructed from the events you just watched arrive.",
		),
	);
	for (const surface of ["spotlight", "work", "artifacts", "agents", "activity"]) {
		await page.evaluate((s) => window.showSurface(s), surface).catch(() => {});
		await sleep(2600);
	}

	await ctx.close();
	await browser.close();
}

async function recordHub() {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({
		viewport: SIZE,
		recordVideo: { dir: join(OUT, "raw-hub"), size: SIZE },
	});
	const page = await ctx.newPage();
	await page.goto(`${HUB}?demoShareScreen=1&demoPlans=1&demoSessions=1`, { waitUntil: "load" });
	await sleep(4000);

	for (const nav of ["Rooms", "Artifacts", "Tasks", "Status Hub", "Analytics"]) {
		try {
			await page.getByRole("link", { name: nav, exact: true }).first().click({ timeout: 5000 });
		} catch {
			try {
				await page.getByText(nav, { exact: true }).first().click({ timeout: 5000 });
			} catch {
				continue;
			}
		}
		await sleep(3200);
		// A slow scroll makes the taller surfaces legible on video.
		await page.mouse.wheel(0, 320);
		await sleep(1800);
	}

	await ctx.close();
	await browser.close();
}

function collect(dir, name) {
	const files = readdirSync(dir).filter((f) => f.endsWith(".webm"));
	if (!files.length) throw new Error(`no video written to ${dir}`);
	const target = join(OUT, name);
	renameSync(join(dir, files[0]), target);
	rmSync(dir, { recursive: true, force: true });
	return target;
}

// ------------------------------------------------------------------ main

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

process.stdout.write("· starting a clean writer\n");
await startWriter(4600);

process.stdout.write("· recording segment 1 — two clients, one writer\n");
await recordScenario();
const scenarioVideo = collect(join(OUT, "raw-scenario"), "01-clients.webm");

process.stdout.write("· recording segment 2 — the hub dashboard\n");
await recordHub();
const hubVideo = collect(join(OUT, "raw-hub"), "02-hub.webm");

process.stdout.write(`\n✓ ${scenarioVideo}\n✓ ${hubVideo}\n`);
