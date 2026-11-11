// The QA fixture tool: installs a nine-session scan into a throwaway Herdr home, restores it,
// and refuses the person's home. Run: node --import ./tests/stubs/register.mjs --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ArcadeCards from "../mods/arcade-cards/main.js";

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

test("the fixture installs nine sessions that parse into every group", () => {
  const root = home();
  try {
    run([root]);
    assert.equal(readFileSync(join(root, "mods", "arcade-cards", "scan.sh.orig"), "utf8"), ORIGINAL,
      "the original scan is kept beside the fixture");
    const stdout = execFileSync("sh", [join(root, "mods", "arcade-cards", "scan.sh")], { encoding: "utf8" });
    const { parsed, model } = modelOf(stdout);
    assert.equal(parsed.sessions.length, 9);
    assert.equal(parsed.meta.t, "meta");
    assert.equal(parsed.meta.error, null);
    for (const row of parsed.sessions) assert.deepEqual(Object.keys(row).sort(), SESSION_FIELDS);
    assert.deepEqual(Object.keys(parsed.meta).sort(), META_FIELDS);

    const waiting = model.attention.filter((item) => item.bucket === "wait");
    const stalls = model.attention.filter((item) => item.bucket === "stall");
    assert.equal(waiting.length, 2, "two sessions need an answer");
    assert.equal(stalls.length, 1, "one busy session has been quiet for twenty minutes");
    assert.equal(model.working.length, 3);
    assert.equal(model.done.length, 3, "two done cards and one opened (viewed) card");
    assert.deepEqual(model.counts, { attention: 3, working: 3, done: 3 });
    assert.deepEqual(model.attention.map((item) => item.sessionId).sort(), ["qa-needs-1", "qa-needs-2", "qa-stall"]);
    assert.deepEqual(model.working.map((item) => item.sessionId).sort(), ["qa-work-1", "qa-work-2", "qa-work-3"]);
    assert.equal(model.done.every((item) => item.viewed === false), true, "nothing is opened until the view says so");
    assert.equal(model.working.find((item) => item.sessionId === "qa-work-1").progress.done, 3);
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
    view.viewed = ["qa-viewed+" + Math.floor(parsed.sessions.find((row) => row.sessionId === "qa-viewed").statusUpdatedAt / 1000)];
    const viewed = view.buildModel(Date.now());
    assert.equal(viewed.done.filter((item) => item.viewed).length, 1);
    assert.equal(viewed.done.find((item) => item.sessionId === "qa-viewed").viewed, true);
    assert.equal(viewed.done.length, 3, "an opened card stays until it is dismissed");
    view.seen = [...view.viewed];
    assert.equal(view.buildModel(Date.now()).done.length, 2, "a seen card leaves the strip");
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
