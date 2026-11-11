// The QA fixture tool: installs the demo cast's scan into a throwaway Herdr home, restores it,
// and refuses the person's home. Run: node --import ./tests/stubs/register.mjs --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ArcadeCards, { castOf } from "../mods/arcade-cards/main.js";
import { assignSpots, machineMoods } from "../mods/arcade-scene/scene.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = join(REPO, "tools", "qa-fixture.sh");
const ORIGINAL = "#!/bin/sh\necho original\n";

// The real scan.sh's fields, so the fixture cannot drift from the format the strip parses.
const SESSION_FIELDS = [
  "agent", "agentName", "background", "completed", "currentAction", "customTitle", "cwd", "deadhd", "identity",
  "jobId", "kind", "lastAnswer", "lastMeaningfulAt", "lastPrompt", "lastSentence", "lastToolAt", "lastToolName",
  "location", "name", "pages", "parkedJobId", "pid", "pr", "sessionId", "startedAt", "status", "statusUpdatedAt",
  "t", "updatedAt", "waitingFor", "where",
];
const META_FIELDS = ["error", "objectives", "pages", "roots", "t", "unreadablePages", "updatedAt"];

function home(dir = null) {
  const root = dir ?? mkdtempSync(join(tmpdir(), "qa-fixture-"));
  mkdirSync(join(root, "mods", "arcade-cards"), { recursive: true });
  writeFileSync(join(root, "mods", "arcade-cards", "scan.sh"), ORIGINAL);
  return root;
}

function run(args, env = {}) {
  return execFileSync("sh", [TOOL, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

function modelOf(stdout) {
  const v = new ArcadeCards();
  const parsed = v.parseScan(stdout);
  Object.assign(v, { sessions: parsed.sessions, meta: parsed.meta, seen: [], viewed: [], snoozed: {}, since: {} });
  return { parsed, model: v.buildModel(Date.now()), view: v };
}

test("the fixture installs thirteen demo sessions that parse into every group", () => {
  const root = home();
  try {
    run([root]);
    assert.equal(readFileSync(join(root, "mods", "arcade-cards", "scan.sh.orig"), "utf8"), ORIGINAL,
      "the original scan is kept beside the fixture");
    const stdout = execFileSync("sh", [join(root, "mods", "arcade-cards", "scan.sh")], { encoding: "utf8" });
    const { parsed, model } = modelOf(stdout);
    assert.equal(parsed.sessions.length, 13);
    assert.equal(parsed.meta.t, "meta");
    assert.equal(parsed.meta.error, null);
    for (const row of parsed.sessions) assert.deepEqual(Object.keys(row).sort(), SESSION_FIELDS);
    assert.deepEqual(Object.keys(parsed.meta).sort(), META_FIELDS);

    const waiting = model.attention.filter((item) => item.bucket === "wait");
    const stalls = model.attention.filter((item) => item.bucket === "stall");
    assert.equal(waiting.length, 1, "one session needs an answer");
    assert.equal(stalls.length, 1, "one busy session has been quiet past ten minutes");
    assert.equal(model.working.length, 9);
    assert.equal(model.done.length, 2, "two done cards, one of them opened (viewed) by the stage");
    assert.deepEqual(model.counts, { attention: 2, working: 9, done: 2 });
    assert.deepEqual(model.attention.map((item) => item.sessionId).sort(),
      ["demo-abc-1401", "demo-web-2230"]);
    assert.equal(model.working.find((item) => item.sessionId === "demo-abc-1402").progress.done, 4);
    assert.deepEqual([...new Set(model.working.map((item) => item.raw.cwd.split("/arcade-demo/")[1].split("/")[0]))].sort(),
      ["api", "docs", "infra", "mobile", "web"]);
    for (const pattern of [/\/Users\//, /\.atlassian\.net\//, /\.slack\.com\/archives\//, /@[a-z0-9-]+\.[a-z]{2,}/i]) {
      assert.equal(pattern.test(stdout), false, `the fixture carries no real path, host or address: ${pattern}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the viewed card is the done one the app has opened, and a seen one leaves", () => {
  const root = home();
  try {
    run([root]);
    const stdout = execFileSync("sh", [join(root, "mods", "arcade-cards", "scan.sh")], { encoding: "utf8" });
    const { parsed, view } = modelOf(stdout);
    view.sessions = parsed.sessions;
    view.meta = parsed.meta;
    view.viewed = ["demo-abc-1472+" + Math.floor(parsed.sessions.find((row) => row.sessionId === "demo-abc-1472").statusUpdatedAt / 1000)];
    const viewed = view.buildModel(Date.now());
    assert.equal(viewed.done.filter((item) => item.viewed).length, 1);
    assert.equal(viewed.done.find((item) => item.sessionId === "demo-abc-1472").viewed, true);
    assert.equal(viewed.done.length, 2, "an opened card stays until it is dismissed");
    view.seen = [...view.viewed];
    assert.equal(view.buildModel(Date.now()).done.length, 1, "a seen card leaves the strip");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the fixture's cards give the marquee every mood", () => {
  const root = home();
  try {
    run([root]);
    const stdout = execFileSync("sh", [join(root, "mods", "arcade-cards", "scan.sh")], { encoding: "utf8" });
    const { parsed, view } = modelOf(stdout);
    view.sessions = parsed.sessions;
    view.meta = parsed.meta;
    view.viewed = ["demo-abc-1472+" + Math.floor(parsed.sessions.find((row) => row.sessionId === "demo-abc-1472").statusUpdatedAt / 1000)];
    const data = view.viewData(Date.now());
    const cast = castOf(data.allGroups, null, () => null);
    assert.equal(cast.length, 13);
    assert.deepEqual([...new Set(cast.map((entry) => entry.mood))].sort(),
      ["done", "needs", "stall", "viewed", "working"]);
    const moods = machineMoods(cast, assignSpots(cast, {}));
    assert.deepEqual([...new Set(moods)].sort(), ["done", "needs", "stall", "working"],
      "the six cabinets mix CONTINUE, HIGH SCORE, PAUSE and a game being played");
    assert.equal(moods.filter((mood) => mood === "working").length, 3,
      "three cabinets show a child playing, one per watching character");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a roster puts the live terminal ids behind the sessions the stage placed", () => {
  const root = home();
  const roster = join(root, "roster.json");
  const fixedAt = 1794200000000;
  writeFileSync(roster, JSON.stringify({
    fixedAt,
    sessions: {
      "demo-abc-1401": { cwd: "/tmp/arcade-demo/api/ABC-1401-refund-rounding", terminalId: "t2" },
      "demo-abc-1472": { cwd: "/tmp/arcade-demo/mobile/ABC-1472-crash-triage", terminalId: "t9" },
    },
  }));
  try {
    run([root, "--roster", roster]);
    const stdout = execFileSync("sh", [join(root, "mods", "arcade-cards", "scan.sh")], { encoding: "utf8" });
    const parsed = new ArcadeCards().parseScan(stdout);
    const fixed = parsed.sessions.find((row) => row.sessionId === "demo-abc-1401");
    const viewed = parsed.sessions.find((row) => row.sessionId === "demo-abc-1472");
    const plain = parsed.sessions.find((row) => row.sessionId === "demo-abc-1402");
    assert.equal(fixed.where.terminalId, "t2");
    assert.equal(fixed.cwd, "/tmp/arcade-demo/api/ABC-1401-refund-rounding");
    assert.equal(viewed.where.terminalId, "t9");
    assert.equal(viewed.statusUpdatedAt, fixedAt, "a viewed session's stamp stays put across scans");
    assert.equal(plain.where.terminalId, null);
    assert.match(plain.cwd, /\/arcade-demo\/api\/ABC-1402-ledger-export$/);
    run([root, "--restore"]);
    assert.equal(existsSync(join(root, "mods", "arcade-cards", "qa-roster.json")), false);
    assert.equal(existsSync(join(root, "mods", "arcade-cards", "qa-sessions.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--restore puts the original scan back", () => {
  const root = home();
  try {
    run([root]);
    run([root, "--restore"]);
    assert.equal(readFileSync(join(root, "mods", "arcade-cards", "scan.sh"), "utf8"), ORIGINAL);
    assert.equal(existsSync(join(root, "mods", "arcade-cards", "scan.sh.orig")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the person's home and an empty argument are refused", () => {
  const person = mkdtempSync(join(tmpdir(), "qa-person-"));
  const personal = join(person, ".config", "herdr-app");
  mkdirSync(join(personal, "mods", "arcade-cards"), { recursive: true });
  writeFileSync(join(personal, "mods", "arcade-cards", "scan.sh"), ORIGINAL);
  try {
    for (const args of [[personal], [""]]) {
      assert.throws(() => run(args, { HOME: person }), (error) => error.status === 1, `refused: ${args.join(" ") || "(empty)"}`);
    }
    assert.equal(readFileSync(join(personal, "mods", "arcade-cards", "scan.sh"), "utf8"), ORIGINAL);
    assert.equal(existsSync(join(personal, "mods", "arcade-cards", "scan.sh.orig")), false);
  } finally {
    rmSync(person, { recursive: true, force: true });
  }
});
