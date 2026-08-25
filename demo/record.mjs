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

import { Pointer } from "./pointer-driver.mjs";
import { chapters } from "./scenario.mjs";
import { startWriter } from "./writer-lifecycle.mjs";

const OUT = process.env.DEMO_OUT ?? "/tmp/drivemode-demo/recording";
const VIEWER = process.env.DEMO_VIEWER_URL ?? "http://127.0.0.1:5173/";
const STAGE = process.env.DEMO_STAGE_URL ?? "http://127.0.0.1:8080/stage/";
const HUB = process.env.DEMO_HUB_URL ?? "http://127.0.0.1:8787/";
const SIZE = { width: 1600, height: 900 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Progress and warnings, on the recorder's own stdout. */
const log = (message) => process.stdout.write(`  ! ${message}\n`);

/**
 * Confirm a URL serves the app we think it does.
 *
 * Vite takes whatever port is free, so "the viewer" and "the hub webview" trade
 * places between runs. A recording that quietly filmed the wrong app would look
 * fine and be worthless, so check the title before spending three minutes on it.
 */
async function expectApp(url, title, label) {
	let html;
	try {
		html = await (await fetch(url, { signal: AbortSignal.timeout(4000) })).text();
	} catch (err) {
		throw new Error(`${label}: nothing answered at ${url} (${err})`);
	}
	const found = html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim();
	if (found !== title) {
		throw new Error(
			`${label}: ${url} serves "${found}", expected "${title}". ` +
				"Pass the URL that app actually printed — do not assume a port.",
		);
	}
}

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

	const pointer = new Pointer(page);
	const phone = page.frameLocator("#phone");
	/** Press a phone tab for real, with the tap drawn where it lands. */
	const tapTab = async (name) => {
		const tab = phone.locator(`.tab[data-surface="${name}"]`);
		const ok = await pointer.clickLocator(tab, { kind: "touch", settle: 900 });
		if (!ok) log(`could not reach the ${name} tab — is the device cut off?`);
	};

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
		if (surface) await tapTab(surface);
		await sleep(1200);
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
	// Back to the first surface by tapping, then walk the rest by swiping —
	// the tab bar and a horizontal swipe are the same navigation in the app,
	// and the recording should show both.
	await tapTab("spotlight");
	const deck = await phone.locator("main").boundingBox();
	if (deck) {
		const midY = deck.y + deck.height * 0.45;
		for (let i = 0; i < 4; i++) {
			await pointer.swipe(
				deck.x + deck.width - 34,
				midY,
				deck.x + 42,
				midY,
				{ settle: 2100 },
			);
		}
	}
	await pointer.hide();
	await sleep(900);

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
	// The hub is not ours, so the overlay goes in as an init script rather than
	// a tag in its markup. It lives in a shadow root and takes no pointer
	// events, so it cannot affect what we are filming.
	await Pointer.inject(page);
	await page.goto(`${HUB}?demoShareScreen=1&demoPlans=1&demoSessions=1`, { waitUntil: "load" });
	await sleep(4000);

	const pointer = new Pointer(page);
	await pointer.mode("mouse");

	for (const nav of ["Rooms", "Artifacts", "Tasks", "Status Hub", "Analytics"]) {
		let link = page.getByRole("link", { name: nav, exact: true }).first();
		if (!(await link.count().catch(() => 0))) {
			link = page.getByText(nav, { exact: true }).first();
		}
		// Move the cursor to the nav item and press it, so the recording shows
		// what was clicked rather than a page that changes on its own.
		const clicked = await pointer
			.clickLocator(link, { settle: 2600 })
			.catch(() => false);
		if (!clicked) {
			log(`hub nav "${nav}" not reachable — skipping`);
			continue;
		}
		// A slow scroll makes the taller surfaces legible on video.
		await page.mouse.wheel(0, 320);
		await sleep(1900);
	}
	await pointer.hide();

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

process.stdout.write("· checking the surfaces are the ones we think\n");
await expectApp(VIEWER, "Drive Mode", "reference viewer");
await expectApp(HUB, "Cline Drive", "hub dashboard");

process.stdout.write("· starting a clean writer\n");
await startWriter(4600);

process.stdout.write("· recording segment 1 — two clients, one writer\n");
await recordScenario();
const scenarioVideo = collect(join(OUT, "raw-scenario"), "01-clients.webm");

process.stdout.write("· recording segment 2 — the hub dashboard\n");
await recordHub();
const hubVideo = collect(join(OUT, "raw-hub"), "02-hub.webm");

process.stdout.write(`\n✓ ${scenarioVideo}\n✓ ${hubVideo}\n`);
