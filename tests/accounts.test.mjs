import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ClaudeAccounts, { launchLine, launchFor, resumeArgs, resumeTemplates, accountChar, pocketWidth, pocketHeight, pocketBlock,
  POCKET_FULL_W, cardWindows, popupWindows, windowText, accountRowHeight, popupKey, errorText,
  parsePorcelain, codexLaunch, menuHeight, creditHintShown, CREDIT_HINT_W } from "../mods/arcade-accounts/main.js";
import { fableOf } from "../mods/arcade-accounts/usage-api.mjs";
import { emailOf, rateLimitsOf } from "../mods/arcade-accounts/codex-usage.mjs";
import { defaultUsage, matchEnv, parseModels, parseUsage, slug, usageCommand } from "../mods/arcade-accounts/models.mjs";

const codexUsage = fileURLToPath(new URL("../mods/arcade-accounts/codex-usage.mjs", import.meta.url));
const codexEvent = JSON.stringify({ type: "event_msg", payload: { rate_limits: {
  primary: { used_percent: 33, window_minutes: 300, resets_at: 1794208378 },
  secondary: { used_percent: 5, window_minutes: 10080, resets_at: 1794795178 },
  plan_type: "plus" } } });

const runLine = (line) => execFileSync("sh", ["-c", line], { env: { ...process.env, SHELL: "/bin/sh" } }).toString();

test("plain claude keeps the direct exec", () => {
  assert.equal(launchLine("CCA_ACCOUNT=work", "claude", " --resume abc"), "CCA_ACCOUNT=work exec claude --resume abc");
});

test("another start command runs through the interactive shell with the account env and args", () => {
  const line = launchLine("CCA_ACCOUNT=work", "printf '%s|%s|%s' \"$CCA_ACCOUNT\"", " --resume abc");
  assert.match(line, /exec "\$\{SHELL:-\/bin\/zsh\}" -ic /);
  assert.equal(runLine(line), "work|--resume|abc");
});

test("launchFor keeps today's line for the Claude accounts", () => {
  assert.equal(launchFor("default", " --resume abc", "claude"),
    "unset CLAUDE_CONFIG_DIR; CCA_ACCOUNT=default exec claude --resume abc");
  assert.equal(launchFor("work", "", "claude"),
    'CLAUDE_CONFIG_DIR="$HOME/.claude-accounts/work" CCA_ACCOUNT=work exec claude');
  assert.equal(launchFor("work", " --resume abc", "ccode"),
    'CLAUDE_CONFIG_DIR="$HOME/.claude-accounts/work" CCA_ACCOUNT=work exec "${SHELL:-/bin/zsh}" -ic \'ccode --resume abc\'');
});

test("a model runs its command through the interactive shell with CLAUDE_CONFIG_DIR unset", () => {
  const dir = mkdtempSync(join(tmpdir(), "model-launch-"));
  try {
    writeFileSync(join(dir, "grok"), '#!/bin/sh\nprintf "%s|%s|%s\\n" "${CLAUDE_CONFIG_DIR-unset}" "$CCA_ACCOUNT" "$*"\n');
    chmodSync(join(dir, "grok"), 0o755);
    const model = { name: "grok", kind: "model", command: "grok --model grok-4" };
    const line = launchFor(model, " --resume abc");
    assert.equal(line,
      'unset CLAUDE_CONFIG_DIR; CCA_ACCOUNT=grok exec "${SHELL:-/bin/zsh}" -ic \'grok --model grok-4 --resume abc\'');
    const out = execFileSync("sh", ["-c", line], {
      env: { ...process.env, SHELL: "/bin/sh", PATH: `${dir}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: "/tmp/elsewhere" },
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim();
    assert.equal(out, "unset|grok|--model grok-4 --resume abc");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a model's resume args come from its template, a Claude account's from --resume", () => {
  const model = { name: "grok", kind: "model", command: "grok", resume: "--resume {id} --continue" };
  assert.equal(resumeArgs(model, "abc"), " --resume abc --continue");
  assert.equal(resumeArgs({ name: "work" }, "abc"), " --resume abc");
  assert.equal(resumeArgs({ kind: "model", resume: null }, "abc"), null);
  assert.equal(launchFor(model, resumeArgs(model, "abc")),
    'unset CLAUDE_CONFIG_DIR; CCA_ACCOUNT=grok exec "${SHELL:-/bin/zsh}" -ic \'grok --resume abc --continue\'');
});

test("continuing as a model puts its {id}-substituted template in the pane command", () => {
  const v = Object.create(ClaudeAccounts.prototype);
  globalThis.herdrRuns = [];
  try {
    const model = { name: "grok", kind: "model", command: "grok --model grok-4", resume: "--resume {id} --continue" };
    const session = { id: "12345678-1234-1234-1234-123456789abc", cwd: "/tmp/my work" };
    v.continueAs(model, session);
    assert.deepEqual(globalThis.herdrRuns, [["pane.split", { direction: "right", argv: ["sh", "-lc",
      `cd '/tmp/my work' && ${launchFor(model, resumeArgs(model, session.id))}`] }]]);
    assert.match(globalThis.herdrRuns[0][1].argv[2], /--resume 12345678-1234-1234-1234-123456789abc --continue/);
  } finally {
    globalThis.herdrRuns = undefined;
  }
});

test("resume templates keep the first usable entry per id and skip the rest", () => {
  const text = JSON.stringify([
    { id: "codex", command: "claude-gpt", resume: "--resume {id}" },
    { id: "codex", command: "other", resume: "--later {id}" },
    { id: "plain", command: "plain" },
    { id: "plain", command: "plain2", resume: "--later {id}" },
    { id: "dated", command: "v1", resume: "first {id}" },
    { id: "dated", command: "v2", resume: "second {id}" },
    { id: "Bad Id", command: "x", resume: "--resume {id}" },
    { id: "late", resume: "--resume {id}" },
    { id: "split", command: "x", resume: "two\tlines" },
    null,
    "nope",
  ]);
  assert.deepEqual(resumeTemplates(text), { codex: "--resume {id}", dated: "first {id}" });
  assert.deepEqual(resumeTemplates("{bad"), {});
  assert.deepEqual(resumeTemplates(""), {});
  assert.deepEqual(resumeTemplates('{"id":"x"}'), {});
});

test("the popup's keys move the highlight and wrap, run or open the row shown, and cancel an editor", () => {
  assert.deepEqual(popupKey("down", 0, 3, false), { at: 1, cancelEdit: false, run: false, open: false });
  assert.deepEqual(popupKey("down", 2, 3, false), { at: 0, cancelEdit: false, run: false, open: false }, "↓ wraps to the first row");
  assert.deepEqual(popupKey("up", 0, 3, false), { at: 2, cancelEdit: false, run: false, open: false }, "↑ wraps to the last row");
  assert.deepEqual(popupKey("enter", 1, 3, false), { at: 1, cancelEdit: false, run: true, open: false });
  assert.deepEqual(popupKey("space", 0, 3, false), { at: 0, cancelEdit: false, run: true, open: false });
  assert.deepEqual(popupKey("o", 1, 3, false), { at: 1, cancelEdit: false, run: false, open: true });
  assert.deepEqual(popupKey("escape", 1, 3, true), { at: 1, cancelEdit: true, run: false, open: false });
  assert.equal(popupKey("down", 0, 3, true), null, "an open editor owns the keyboard");
  assert.equal(popupKey("o", 0, 3, true), null, "an open editor owns the keyboard");
  assert.equal(popupKey("down", 0, 0, false), null, "an empty popup takes no key");
  assert.equal(popupKey("escape", 0, 3, false), null, "Esc with no editor open is the host's");
});

test("a failure line drops its full stop and falls back to the next step", () => {
  assert.equal(errorText({ stderr: "boom.\n" }, "fallback"), "boom");
  assert.equal(errorText({ stderr: "bad name.", stdout: "worse" }, "fallback"), "bad name");
  assert.equal(errorText({ stdout: "" }, "fallback"), "fallback");
  assert.equal(errorText(null, "fallback"), "fallback");
});

test("only one in-place editor is open at a time, so the popup's single hint line fits", () => {
  const v = Object.create(ClaudeAccounts.prototype);
  const cx = { notify() {}, timer: { after() {} } };
  v.launch = "claude";
  v.startLaunchEdit(cx);
  v.startRename({ name: "work" }, cx);
  assert.equal(v.launchEdit, null);
  assert.equal(v.rename.name, "work");
  v.startLaunchEdit(cx);
  assert.equal(v.rename, null);
  assert.ok(v.launchEdit);
});

test("an account keeps its rail character when the focused account moves to the top", () => {
  const work = { name: "default" }, personal = { name: "personal" };
  const list = [work, personal];
  assert.equal(accountChar(list, work), "kid");
  assert.equal(accountChar(list, personal), "robot");
  const v = Object.create(ClaudeAccounts.prototype);
  const seen = [];
  Object.assign(v, {
    accounts: list, current: "personal", currentKey: "7", focusKey: "7", globalDefault: "default",
    focusedPid: () => 7, pocketAvatar: (a, here, who) => { seen.push([a.name, here, who]); return null; },
  });
  v.rail({});
  assert.deepEqual(seen, [["personal", true, "robot"], ["default", false, "kid"]]);
});

test("the pocket card avatar renders for empty and over-90 % usage", () => {
  const v = Object.create(ClaudeAccounts.prototype);
  v.globalDefault = "default";
  assert.doesNotThrow(() => v.pocketAvatar({ name: "default", usage: null }, false, "kid"));
  assert.doesNotThrow(() => v.pocketAvatar({ name: "w", usage: { five: { used: 95, reset: 0 }, seven: { used: 10 } } }, true, "robot"));
  assert.doesNotThrow(() => v.pocketAvatar({ name: "w", usage: null }, true, "robot", 168));
});

test("the narrow rail prints CREDIT alone, with the shortcut left to the tooltip", () => {
  assert.equal(CREDIT_HINT_W, 110);
  assert.equal(creditHintShown(76), false, "the 76 px rail has no room for the shortcut");
  assert.equal(creditHintShown(0), false, "before the rail measures, only CREDIT");
  assert.equal(creditHintShown(CREDIT_HINT_W), true, "a wide rail prints it beside CREDIT");
});

test("pocket cards widen with the rail up to its 200 px max", () => {
  assert.equal(pocketWidth(76), 44);
  assert.equal(pocketWidth(0), 44);
  assert.equal(pocketWidth(150), 118);
  assert.equal(pocketWidth(400), 168);
  assert.ok(pocketWidth(128) >= POCKET_FULL_W);
  assert.deepEqual([pocketHeight(44), pocketHeight(168)], [52, 199]);
  assert.equal(pocketBlock(2, 44), 146);
  assert.equal(pocketBlock(2, 168), 440);
  assert.equal(pocketBlock(0, 44), 86);
});

test("the rail resizes its accounts block to hold the cards, once per change", () => {
  const v = Object.create(ClaudeAccounts.prototype);
  Object.assign(v, { accounts: [{ name: "a" }, { name: "b" }], width: 200, blockPx: null });
  globalThis.herdrRuns = [];
  v.syncBlock();
  v.syncBlock();
  v.width = 76;
  v.syncBlock();
  assert.deepEqual(globalThis.herdrRuns, [
    ["layout.resize", { id: "rail-accounts", px: 440 }],
    ["layout.resize", { id: "rail-accounts", px: 146 }],
  ]);
  globalThis.herdrRuns = undefined;
});

test("an Ultra account's card shows 7d and Fable, other plans 5h and 7d", () => {
  const usage = { five: { used: 12, reset: null }, seven: { used: 9, reset: null }, fable: { used: 30, reset: null } };
  const labels = (ws) => ws.map(([label, w]) => [label, w?.used ?? null]);
  assert.deepEqual(labels(cardWindows({ plan: "Ultra", usage })), [["7d", 9], ["Fable", 30]]);
  assert.deepEqual(labels(cardWindows({ plan: null, usage })), [["5h", 12], ["7d", 9]]);
  assert.deepEqual(labels(cardWindows({ plan: "Ultra", usage: null })), [["7d", null], ["Fable", null]]);
});

test("the popup lists every reported window plus the card's two, in 5h, 7d, Fable order", () => {
  const labels = (a) => popupWindows(a).map(([label]) => label);
  assert.deepEqual(labels({ plan: null, usage: { five: { used: 1 }, seven: { used: 2 }, fable: { used: 0 } } }), ["5h", "7d", "Fable"]);
  assert.deepEqual(labels({ plan: "Ultra", usage: { five: null, seven: { used: 9 }, fable: null } }), ["7d", "Fable"]);
  assert.deepEqual(labels({ plan: null, usage: null }), ["5h", "7d"]);
  assert.equal(accountRowHeight({ plan: null, usage: { five: { used: 1 }, seven: { used: 2 }, fable: { used: 0 } } }), 52 + 3 * 22 + 8);
});

test("a window reads as its percentage and reset, a spent one as 0 % with no reset", () => {
  const now = Date.now() / 1000;
  const later = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date((now + 3 * 86400) * 1000).getDay()];
  assert.equal(windowText(["7d", { used: 42.4, reset: now + 3 * 86400 }]), `7d 42% ↻ ${later}`);
  assert.equal(windowText(cardWindows({ usage: { five: { used: 80, reset: now - 10 } } })[0]), "5h 0%");
  assert.equal(windowText(["Fable", null]), "Fable –");
});

test("the popup height with only Claude installed is the Agents section, its accounts and the hint", () => {
  const account = { name: "default", usage: null };
  const h = menuHeight({ agents: [{ key: "claude" }], claudeAccounts: [account] });
  assert.equal(h, 12 + 24 + 40 + accountRowHeight(account) + 28 + 32 + 13 + 24 + 32 + 18,
    "12 px padding, Agents header, the agent row, its account, Add Claude account, Claude command, the Custom commands header and its add row, hint");
});

test("the popup height adds a Codex row and each Codex account under it", () => {
  const account = { name: "default", usage: null };
  const base = menuHeight({ agents: [{ key: "claude" }], claudeAccounts: [account] });
  const codexUsed = { name: "work", usage: { five: { used: 33, reset: 1794208378 }, seven: { used: 5, reset: 1794795178 } } };
  const h = menuHeight({ agents: [{ key: "claude" }, { key: "codex" }],
    claudeAccounts: [account], codexAccounts: [account, codexUsed] });
  assert.equal(h - base, 40 + accountRowHeight(account) + accountRowHeight(codexUsed) + 28);
  assert.equal(accountRowHeight(codexUsed), 52 + 2 * 22 + 8);
  assert.equal(menuHeight({ agents: [{ key: "claude" }], claudeAccounts: [account], codexAccounts: [account] }),
    base, "no Codex agent row means no Codex accounts and no add row");
});

test("the popup height adds each custom command, the resume section and the not-installed line", () => {
  const account = { name: "default", usage: null };
  const base = menuHeight({ agents: [{ key: "claude" }], claudeAccounts: [account] });
  const used = { name: "gpt", kind: "model",
    usage: { five: { used: 33, reset: 1794208378 }, seven: { used: 5, reset: 1794795178 } } };
  const bare = { name: "gemini", kind: "model", usage: null };
  assert.equal(accountRowHeight(bare), 52 + 22 + 8, "an untracked model keeps one 22 px line");
  assert.equal(menuHeight({ agents: [{ key: "claude" }], claudeAccounts: [account], models: [used, bare] }) - base,
    accountRowHeight(used) + accountRowHeight(bare),
    "the section and its add row are counted even before any model exists");
  assert.equal(menuHeight({ agents: [{ key: "claude" }], claudeAccounts: [account], models: [] }),
    12 + 24 + 40 + accountRowHeight(account) + 28 + 32 + 13 + 24 + 32 + 18,
    "an empty models list still counts the Custom commands header and its add row");
  assert.equal(menuHeight({ agents: [{ key: "claude" }], claudeAccounts: [account], resumeCount: 2 }) - base,
    13 + 24 + 2 * 32, "one separator, the resume header and its rows");
  assert.equal(menuHeight({ agents: [{ key: "claude" }], claudeAccounts: [account], notInstalledCount: 2 }) - base, 24);
});

test("parsePorcelain reads every line kind into accounts, models, labels and the Codex list", () => {
  const id = "12345678-1234-1234-1234-123456789abc";
  const text = [
    "C\twork",
    "D\tpersonal",
    "A\tdefault\tw@x",
    "A\twork\tp@x",
    "M\tgpt\tclaude-gpt\t1",
    "U\tdefault\t12\t100\t9\t200\t\t",
    "P\tdefault\tMax",
    "L\tdefault\tMe",
    "L\tgpt\tGPT",
    `S\t${id}\t/tmp/my work`,
    "Y\twork",
    "X\tdefault\tcodex@x",
    "X\twork\twork@x",
    "V\twork\t33\t1000\t5\t2000",
    "Q\twork\tChatGPT Plus",
    "L\tcodex:work\tWork Codex",
  ].join("\n");
  const p = parsePorcelain(text);
  assert.equal(p.current, "work");
  assert.equal(p.globalDefault, "personal");
  assert.deepEqual(p.session, { id, cwd: "/tmp/my work" });
  assert.deepEqual(p.accounts.map((a) => [a.name, a.email, a.label]), [["default", "w@x", "Me"], ["work", "p@x", null]]);
  assert.deepEqual(p.accounts[0].usage, { five: { used: 12, reset: 100 }, seven: { used: 9, reset: 200 }, fable: null });
  assert.equal(p.accounts[0].plan, "Max");
  assert.deepEqual(p.models.map((m) => [m.name, m.kind, m.command, m.resumable, m.label]),
    [["gpt", "model", "claude-gpt", true, "GPT"]]);
  assert.equal(p.codex.active, "work");
  assert.deepEqual(p.codex.accounts.map((c) => [c.name, c.email, c.plan, c.label]), [
    ["default", "codex@x", null, null],
    ["work", "work@x", "ChatGPT Plus", "Work Codex"],
  ]);
  assert.deepEqual(p.codex.accounts[1].usage,
    { five: { used: 33, reset: 1000 }, seven: { used: 5, reset: 2000 }, fable: null });
  assert.equal(p.codex.accounts[0].usage, null);
});

test("the stage's CREDIT fake answers porcelain the real parser reads", () => {
  const fake = fileURLToPath(new URL("../tools/qa-cca.sh", import.meta.url));
  for (const args of [["--porcelain"], ["--porcelain", "4242"]]) {
    const p = parsePorcelain(execFileSync("sh", [fake, ...args], { encoding: "utf8" }));
    assert.equal(p.current, "work");
    assert.equal(p.globalDefault, "work");
    assert.deepEqual(p.accounts.map((a) => a.name), ["work", "personal", "Codex"]);
    assert.deepEqual(p.accounts.map((a) => a.plan), ["Max Ultra", "Max", "Pro"]);
    assert.equal(p.accounts[0].usage.five.used, 21);
    assert.equal(p.accounts[0].usage.seven.used, 79);
    assert.equal(p.accounts[0].usage.fable.used, 5);
    assert.deepEqual({ five: p.accounts[1].usage.five.used, seven: p.accounts[1].usage.seven.used }, { five: 12, seven: 34 });
    assert.equal(p.accounts[1].usage.fable, null);
    assert.equal(typeof p.accounts[1].usage.seven.reset, "number");
    assert.equal(p.accounts[2].usage.five.used, 0);
    assert.equal(p.accounts[2].usage.seven.used, 11);
    assert.deepEqual(cardWindows(p.accounts[0]).map(([label]) => label), ["7d", "Fable"]);
    assert.deepEqual(cardWindows(p.accounts[1]).map(([label]) => label), ["5h", "7d"]);
  }
  assert.throws(() => execFileSync("sh", [fake, "use", "work"], { stdio: "ignore" }), (error) => error.status === 2);
});

test("parsePorcelain always offers the system Codex login and ignores broken lines", () => {
  const p = parsePorcelain("X\tbad name\tx\nY\tbad name\nV\t\nQ\t");
  assert.deepEqual(p.codex, { active: "default", accounts: [{ name: "default", email: "", usage: null, plan: null, label: null }] });
  assert.deepEqual(parsePorcelain(""), {
    current: "default", globalDefault: "default", session: null,
    accounts: [], models: [], labels: {},
    codex: { active: "default", accounts: [{ name: "default", email: "", usage: null, plan: null, label: null }] },
  });
});

test("codexLaunch quotes the run words and keeps $HOME outside the quotes", () => {
  assert.equal(codexLaunch(null, ["codex", "--full-auto"]), "exec 'codex' '--full-auto'");
  assert.equal(codexLaunch("/tmp/x", ["codex"]), "CODEX_HOME='/tmp/x' exec 'codex'");
  assert.equal(codexLaunch("/tmp/it's here", ["codex", "a b"]), `CODEX_HOME='/tmp/it'\\''s here' exec 'codex' 'a b'`);
  assert.match(codexLaunch("~/.codex-accounts/work", ["codex"]), /^CODEX_HOME="\$HOME"\/'.codex-accounts\/work' exec 'codex'$/);
});

test("cca prints the plan and the Fable window from the usage endpoint's record", () => {
  const home = execFileSync("mktemp", ["-d"]).toString().trim();
  const state = `${home}/state/herdr-tower/usage`;
  execFileSync("mkdir", ["-p", state, `${home}/.claude-accounts/personal`]);
  const fs = { "/.claude.json": '{"oauthAccount":{"emailAddress":"w@x","planDisplayName":"Ultra"}}',
    "/.claude-accounts/personal/.claude.json": '{"oauthAccount":{"emailAddress":"p@x"}}' };
  for (const [f, body] of Object.entries(fs)) execFileSync("sh", ["-c", 'printf %s "$1" > "$2"', "x", body, home + f]);
  execFileSync("sh", ["-c", 'printf %s "$1" > "$2"', "x", '{"seven_day":{"used":9,"resets_at":4102444800}}', `${state}/default.json`]);
  execFileSync("sh", ["-c", 'printf %s "$1" > "$2"', "x", '{"fetched_at":1,"fable":{"used":3,"resets_at":4102444800}}', `${state}/default.api.json`]);
  execFileSync("touch", [`${state}/.api-fetch`]);
  const out = execFileSync("sh", ["mods/arcade-accounts/cca", "--porcelain"],
    { env: { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` } }).toString();
  assert.match(out, /^P\tdefault\tUltra$/m);
  assert.match(out, /^U\tdefault\t\t\t9\t4102444800\t3\t4102444800$/m);
  assert.doesNotMatch(out, /^P\tpersonal/m);
  execFileSync("rm", ["-rf", home]);
});

// A temp HOME with the usage folder's stamp already fresh, so cca never reaches the network.
const towerHome = (prefix) => {
  const home = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(`${home}/state/herdr-tower/usage`, { recursive: true });
  writeFileSync(`${home}/state/herdr-tower/usage/.api-fetch`, "");
  return home;
};

test("cca use accepts a model id, and an unknown name is refused as no account or agent", () => {
  const home = towerHome("use-model-");
  try {
    writeFileSync(`${home}/state/herdr-tower/models.json`, JSON.stringify([{ id: "gpt", command: "claude-gpt" }]));
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const cca = "mods/arcade-accounts/cca";
    const use = (...args) => spawnSync("sh", [cca, "use", ...args], { env, encoding: "utf8" });

    const chosen = use("gpt");
    assert.equal(chosen.status, 0);
    assert.equal(chosen.stdout.trim(), "gpt");
    assert.equal(readFileSync(`${home}/state/herdr-tower/current`, "utf8").trim(), "gpt");
    const porcelain = spawnSync("sh", [cca, "--porcelain"], { env, encoding: "utf8" });
    assert.match(porcelain.stdout, /^D\tgpt$/m);

    const unknown = use("nope");
    assert.equal(unknown.status, 3);
    assert.equal(unknown.stderr.trim(), "cca: No account or agent nope.");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a model named codex is usable, while a folder named codex is refused", () => {
  const home = towerHome("use-codex-");
  try {
    writeFileSync(`${home}/state/herdr-tower/models.json`,
      JSON.stringify([{ id: "codex", label: "Codex", command: "claude-gpt" }]));
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const cca = "mods/arcade-accounts/cca";
    const run = (...args) => spawnSync("sh", [cca, ...args], { env, encoding: "utf8" });

    const chosen = run("use", "codex");
    assert.equal(chosen.status, 0);
    assert.equal(chosen.stdout.trim(), "codex");
    assert.equal(run("current").stdout.trim(), "codex");

    const add = run("add", "codex");
    assert.equal(add.status, 2);
    assert.equal(add.stderr.trim(), "codex is a cca command.");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("cca codex add links ~/.codex's config and sessions but leaves auth.json and machine state behind", () => {
  const home = towerHome("codex-add-");
  try {
    mkdirSync(`${home}/.codex/sessions/2026/11/09`, { recursive: true });
    writeFileSync(`${home}/.codex/config.toml`, 'model = "gpt-5"\n');
    writeFileSync(`${home}/.codex/auth.json`, '{"tokens":{"id_token":"x"}}');
    writeFileSync(`${home}/.codex/state.sqlite`, "db");
    writeFileSync(`${home}/.codex/.tmp`, "tmp");
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const cca = "mods/arcade-accounts/cca";
    const run = (...args) => spawnSync("sh", [cca, ...args], { env, encoding: "utf8" });

    const add = run("codex", "add", "work");
    assert.equal(add.status, 0);
    assert.match(add.stdout, /^Created ~\/\.codex-accounts\/work\.$/m);
    assert.match(add.stdout, /^Log in with: CODEX_HOME=~\/\.codex-accounts\/work codex login$/m);

    const dir = `${home}/.codex-accounts/work`;
    assert.equal(readFileSync(`${dir}/config.toml`, "utf8"), 'model = "gpt-5"\n', "the config is linked");
    assert.ok(lstatSync(`${dir}/sessions`).isSymbolicLink(), "the shared session history is a link");
    assert.equal(readlinkSync(`${dir}/sessions`), `${home}/.codex/sessions`);
    assert.ok(lstatSync(`${dir}/archived_sessions`).isSymbolicLink());
    assert.ok(lstatSync(`${dir}/history.jsonl`).isSymbolicLink(), "history is created and shared");
    assert.equal(existsSync(`${dir}/auth.json`), false, "the login is not shared");
    assert.equal(existsSync(`${dir}/state.sqlite`), false, "machine state stays behind");
    assert.equal(existsSync(`${dir}/.tmp`), false);

    assert.equal(run("codex", "add", "work").status, 3, "an existing account folder is refused");
    assert.equal(run("codex", "add", "bad name").status, 2);
    assert.equal(run("codex", "add", "default").status, 2);
    assert.equal(run("codex", "add", "codex").status, 2, "codex is now a cca command");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("cca codex use writes codex-current, refusing a bad name with 2 and a missing account with 3", () => {
  const home = towerHome("codex-use-");
  try {
    mkdirSync(`${home}/.codex-accounts/work`, { recursive: true });
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const cca = "mods/arcade-accounts/cca";
    const use = (...args) => spawnSync("sh", [cca, "codex", "use", ...args], { env, encoding: "utf8" });

    const chosen = use("work");
    assert.equal(chosen.status, 0);
    assert.equal(chosen.stdout.trim(), "work");
    assert.equal(readFileSync(`${home}/state/herdr-tower/codex-current`, "utf8").trim(), "work");
    assert.match(spawnSync("sh", [cca, "--porcelain"], { env, encoding: "utf8" }).stdout, /^Y\twork$/m);

    assert.equal(use("default").status, 0);
    assert.equal(readFileSync(`${home}/state/herdr-tower/codex-current`, "utf8").trim(), "default");

    const missing = use("nope");
    assert.equal(missing.status, 3);
    assert.equal(missing.stderr.trim(), "cca: No Codex account nope.");
    const bad = use("bad name");
    assert.equal(bad.status, 2);
    assert.equal(bad.stderr.trim(), "cca: Use letters, digits, - or _.");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("cca prints each Codex home's X, V and Q lines with the login from auth.json", () => {
  const home = towerHome("codex-porcelain-");
  try {
    const day = `${home}/.codex/sessions/2026/11/09`;
    mkdirSync(day, { recursive: true });
    writeFileSync(`${day}/rollout-x.jsonl`, `${codexEvent}\n`);
    const token = `h.${Buffer.from(JSON.stringify({ email: "me@x" })).toString("base64url")}.s`;
    writeFileSync(`${home}/.codex/auth.json`, JSON.stringify({ tokens: { id_token: token } }));
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const cca = "mods/arcade-accounts/cca";

    const add = spawnSync("sh", [cca, "--porcelain-add-codex", "work"], { env, encoding: "utf8" });
    assert.equal(add.status, 0);
    assert.equal(add.stdout.trim(), `${home}/.codex-accounts/work`);
    writeFileSync(`${home}/.codex-accounts/work/auth.json`,
      JSON.stringify({ tokens: { id_token: `h.${Buffer.from(JSON.stringify({ email: "work@x" })).toString("base64url")}.s` } }));

    const out = execFileSync("sh", [cca, "--porcelain"], { env }).toString();
    assert.match(out, /^Y\tdefault$/m);
    assert.match(out, /^X\tdefault\tme@x$/m);
    assert.match(out, /^X\twork\twork@x$/m);
    assert.match(out, /^V\tdefault\t33\t1794208378\t5\t1794795178$/m);
    assert.match(out, /^Q\tdefault\tChatGPT Plus$/m);
    assert.match(out, /^V\twork\t33\t1794208378\t5\t1794795178$/m);
    assert.match(out, /^Q\twork\tChatGPT Plus$/m);

    assert.equal(emailOf(`${home}/.codex`), "me@x");
    const email = spawnSync(process.execPath, [codexUsage, "--email", `${home}/.codex`], { encoding: "utf8" });
    assert.equal(email.status, 0);
    assert.equal(email.stdout.trim(), "me@x");
    const none = spawnSync(process.execPath, [codexUsage, "--email", `${home}/missing`], { encoding: "utf8" });
    assert.equal(none.status, 0);
    assert.equal(none.stdout, "");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("cca's shell hook defines codex() beside claude() and reads codex-current", () => {
  const env = { ...process.env, SHELL: "/bin/sh" };
  const out = execFileSync("sh", ["mods/arcade-accounts/cca", "shell-init"], { env }).toString();
  assert.match(out, /^claude\(\) \{/m, "the Claude hook stays");
  assert.match(out, /^codex\(\) \{/m);
  assert.match(out, /herdr-tower\/codex-current/);
  assert.match(out, /CODEX_HOME="\$HOME\/\.codex-accounts\/\$_cca_codex" command codex "\$@"/);
});

test("a default model id that is no longer in models.json falls back to default", () => {
  const home = towerHome("current-gone-");
  try {
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const cca = "mods/arcade-accounts/cca";
    const current = () => spawnSync("sh", [cca, "current"], { env, encoding: "utf8" }).stdout.trim();
    writeFileSync(`${home}/state/herdr-tower/models.json`, JSON.stringify([{ id: "gpt", command: "claude-gpt" }]));
    writeFileSync(`${home}/state/herdr-tower/current`, "gpt\n");
    assert.equal(current(), "gpt");
    rmSync(`${home}/state/herdr-tower/models.json`);
    assert.equal(current(), "default");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("models.mjs keeps valid entries and skips invalid ones individually", () => {
  const home = mkdtempSync(join(tmpdir(), "models-parse-"));
  try {
    mkdirSync(join(home, ".claude-accounts", "work"), { recursive: true });
    const text = JSON.stringify([
      { id: "gpt", label: "Codex", command: "claude-gpt", resume: "--resume {id}",
        detect: "ANTHROPIC_BASE_URL=http://127.0.0.1:8317" },
      { id: "Bad Id", command: "x" },
      { id: "default", command: "x" },
      { id: "share", command: "x" },
      { id: "gpt", command: "duplicate" },
      { id: "gemini" },
      { id: "grok", command: "grok\nx" },
      { id: "work", command: "x" },
      { id: "-x", command: "x" },
      "nope",
      { id: "mine", command: " mine ", label: " ", usage: "codex-rollout ~/.codex", resume: "", detect: "BAD" },
      { id: "tabbed", command: "x", label: "Two\tLines\nHere" },
    ]);
    const models = parseModels(text, { home });
    assert.deepEqual(models.map((m) => m.id), ["gpt", "mine", "tabbed"]);
    assert.equal(models[0].command, "claude-gpt");
    assert.equal(models[0].label, "Codex");
    assert.equal(models[0].resume, "--resume {id}");
    assert.equal(models[0].detect, "ANTHROPIC_BASE_URL=http://127.0.0.1:8317");
    assert.equal(models[1].command, "mine");
    assert.equal(models[1].label, undefined);
    assert.equal(models[1].resume, undefined);
    assert.equal(models[1].detect, undefined);
    assert.equal(models[2].label, undefined, "a tab or newline would break the porcelain L line");
    assert.deepEqual(parseModels("{bad", { home }), []);
    assert.deepEqual(parseModels('{"id":"x"}', { home }), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a model id is its label lower-cased with spaces as dashes", () => {
  assert.equal(slug("My Grok"), "my-grok");
  assert.equal(slug("Gemini 2.5!"), "gemini-25");
  assert.equal(slug("Codex"), "codex");
  assert.equal(slug("!!"), "");
});

test("the first model whose detect line or CCA_ACCOUNT appears in the pane env wins", () => {
  const models = [
    { id: "codex", detect: "ANTHROPIC_BASE_URL=http://127.0.0.1:8317" },
    { id: "gemini", detect: "GEMINI_HOME=/x" },
  ];
  assert.equal(matchEnv(models, ["/usr/bin/claude ANTHROPIC_BASE_URL=http://127.0.0.1:8317 HOME=/x"]), "codex");
  assert.equal(matchEnv(models, ["CCA_ACCOUNT=gemini"]), "gemini");
  assert.equal(matchEnv(models, ["CCA_ACCOUNT=other", "HOME=/x"]), null);
  assert.equal(matchEnv(models, []), null);
  assert.equal(matchEnv([{ id: "a", detect: "X=1" }, { id: "b", detect: "X=2" }], ["X=2", "X=1"]), "a");
});

test("a usage line's five tab fields are read, blanks and all", () => {
  assert.deepEqual(parseUsage("33\t1794208378\t5\t1794795178\tplus\n"),
    { fiveUsed: "33", fiveReset: "1794208378", sevenUsed: "5", sevenReset: "1794795178", plan: "plus" });
  assert.deepEqual(parseUsage("7\t\t\t\tsolo"),
    { fiveUsed: "7", fiveReset: "", sevenUsed: "", sevenReset: "", plan: "solo" });
  assert.equal(parseUsage(""), null);
  assert.equal(parseUsage("\n\t\t\t\t\n"), null);
});

test("the codex-rollout usage word points at the bundled reader", () => {
  assert.equal(usageCommand("codex-rollout ~/.codex", "/mods/x", "/home/u"),
    `'${process.execPath}' '/mods/x/codex-usage.mjs' '/home/u/.codex'`);
  assert.equal(usageCommand("printf hi", "/mods/x", "/home/u"), "printf hi");
});

test("cca lists the models file's entries with their usage and label, the labels file's label last", () => {
  const home = towerHome("models-porcelain-");
  try {
    mkdirSync(`${home}/bin`);
    const ps = `${home}/bin/ps`;
    writeFileSync(ps, "#!/bin/sh\nprintf '%s\\n' '/usr/bin/claude CCA_ACCOUNT=gpt HOME=/x'\n");
    chmodSync(ps, 0o755);
    writeFileSync(`${home}/state/herdr-tower/models.json`, JSON.stringify([
      { id: "gpt", label: "Codex", command: "claude-gpt", resume: "--resume {id}",
        usage: "printf '33\\t1794208378\\t5\\t1794795178\\tplus\\n'",
        detect: "ANTHROPIC_BASE_URL=http://127.0.0.1:8317" },
      { id: "gemini", label: "Gemini", command: "gemini" },
    ]));
    writeFileSync(`${home}/state/herdr-tower/labels`, "gpt\tMy Codex\n");
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state`, CCA_PS: ps };
    const r = spawnSync("sh", ["mods/arcade-accounts/cca", "--porcelain", "12345"], { env, encoding: "utf8" });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^C\tgpt$/m);
    assert.match(r.stdout, /^M\tgpt\tclaude-gpt\t1$/m);
    assert.match(r.stdout, /^L\tgpt\tCodex$/m, "the file's label reaches the popup");
    assert.match(r.stdout, /^L\tgpt\tMy Codex$/m);
    assert.match(r.stdout, /^U\tgpt\t33\t1794208378\t5\t1794795178\t\t$/m);
    assert.match(r.stdout, /^P\tgpt\tChatGPT Plus$/m);
    assert.match(r.stdout, /^M\tgemini\tgemini\t0$/m);
    assert.match(r.stdout, /^L\tgemini\tGemini$/m);
    assert.doesNotMatch(r.stdout, /^U\tgemini/m);
    assert.doesNotMatch(r.stdout, /^P\tgemini/m);
    assert.ok(r.stdout.indexOf("L\tgpt\tCodex") < r.stdout.indexOf("L\tgpt\tMy Codex"),
      "main.js keeps the last L, so the labels file's rename wins over the file's label");
    assert.deepEqual(r.stdout.split("\n").filter(Boolean).map((line) => line.split("\t")[0]),
      ["C", "D", "A", "M", "L", "U", "P", "M", "L", "L"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a codex-rollout usage word reads codex-usage.mjs under the temp HOME", () => {
  const home = towerHome("models-rollout-");
  try {
    const day = `${home}/.codex/sessions/2026/11/09`;
    mkdirSync(day, { recursive: true });
    writeFileSync(`${day}/rollout-x.jsonl`, `${codexEvent}\n`);
    writeFileSync(`${home}/state/herdr-tower/models.json`, JSON.stringify([
      { id: "local-codex", command: "claude-gpt", usage: "codex-rollout ~/.codex" },
    ]));
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const out = execFileSync("sh", ["mods/arcade-accounts/cca", "--porcelain"], { env }).toString();
    assert.match(out, /^M\tlocal-codex\tclaude-gpt\t0$/m);
    assert.match(out, /^U\tlocal-codex\t33\t1794208378\t5\t1794795178\t\t$/m);
    assert.match(out, /^P\tlocal-codex\tChatGPT Plus$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a missing or broken models file adds no model lines and still exits 0", () => {
  const home = towerHome("models-none-");
  try {
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const run = () => spawnSync("sh", ["mods/arcade-accounts/cca", "--porcelain"], { env, encoding: "utf8" });
    let r = run();
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /^M\t/m);
    writeFileSync(`${home}/state/herdr-tower/models.json`, "{broken");
    r = run();
    assert.equal(r.status, 0);
    assert.doesNotMatch(r.stdout, /^M\t/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("--porcelain-add-model writes the entry and refuses bad ones", () => {
  const home = towerHome("models-add-");
  try {
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const cca = "mods/arcade-accounts/cca";
    const add = (...args) => spawnSync("sh", [cca, "--porcelain-add-model", ...args], { env, encoding: "utf8" });
    const first = add("My Grok", "grok --x");
    assert.equal(first.status, 0);
    assert.equal(first.stdout.trim(), "my-grok");
    const file = `${home}/state/herdr-tower/models.json`;
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")),
      [{ id: "my-grok", label: "My Grok", command: "grok --x" }]);
    const duplicate = add("My Grok", "grok --x");
    assert.equal(duplicate.status, 2);
    assert.doesNotMatch(duplicate.stderr.trim(), /\.$/, "a refusal is one line without a full stop");
    assert.equal(add("default", "x").status, 2);
    assert.equal(add("share", "x").status, 2);
    assert.equal(add("Bad", "one\ntwo").status, 2);
    assert.equal(add("No command", "").status, 2);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).length, 1);

    const account = spawnSync("sh", [cca, "add", "my-grok"], { env, encoding: "utf8" });
    assert.equal(account.status, 2);
    assert.match(account.stderr, /my-grok is a model/);

    const rename = spawnSync("sh", [cca, "--porcelain-rename", "my-grok", "Grok"], { env, encoding: "utf8" });
    assert.equal(rename.status, 0);
    assert.match(readFileSync(`${home}/state/herdr-tower/labels`, "utf8"), /^my-grok\tGrok$/m);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("adding a codex command stores the codex-rollout usage, another command does not", () => {
  const home = towerHome("models-codex-");
  try {
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state` };
    const cca = "mods/arcade-accounts/cca";
    const add = (...args) => spawnSync("sh", [cca, "--porcelain-add-model", ...args], { env, encoding: "utf8" });
    assert.equal(add("Codex", "codex").status, 0);
    assert.equal(add("Local Codex", "/usr/local/bin/codex --x").status, 0);
    assert.equal(add("GPT", "claude-gpt").status, 0);
    const entries = JSON.parse(readFileSync(`${home}/state/herdr-tower/models.json`, "utf8"));
    assert.deepEqual(entries.map((m) => [m.id, m.usage]), [
      ["codex", "codex-rollout ~/.codex"],
      ["local-codex", "codex-rollout ~/.codex"],
      ["gpt", undefined],
    ]);
    assert.equal(defaultUsage("codex"), "codex-rollout ~/.codex");
    assert.equal(defaultUsage("bin/codex --full-auto"), "codex-rollout ~/.codex");
    assert.equal(defaultUsage("codex-cli"), null);
    assert.equal(defaultUsage("claude-gpt"), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ps -E shows no environment in the test sandbox, so CCA_PS points at a stub printing the pane's line.
const paneOut = (lineOf, models) => {
  const home = mkdtempSync(join(tmpdir(), "pane-"));
  try {
    mkdirSync(`${home}/state/herdr-tower/usage`, { recursive: true });
    writeFileSync(`${home}/state/herdr-tower/usage/.api-fetch`, "");
    mkdirSync(`${home}/.claude-accounts/work`, { recursive: true });
    mkdirSync(`${home}/bin`);
    if (models !== undefined) writeFileSync(`${home}/state/herdr-tower/models.json`, models);
    const ps = `${home}/bin/ps`;
    writeFileSync(ps, `#!/bin/sh\nprintf '%s\\n' "${lineOf(home)}"\n`);
    chmodSync(ps, 0o755);
    const env = { ...process.env, HOME: home, XDG_STATE_HOME: `${home}/state`, CCA_PS: ps };
    return execFileSync("sh", ["mods/arcade-accounts/cca", "--porcelain", "12345"], { env })
      .toString().split("\n")[0];
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
};

test("cca reads a pane whose environment matches a model's detect as that model", () => {
  const models = JSON.stringify([
    { id: "gpt", command: "claude-gpt", detect: "ANTHROPIC_BASE_URL=http://127.0.0.1:8317" },
  ]);
  assert.equal(paneOut(() => "/usr/bin/claude ANTHROPIC_BASE_URL=http://127.0.0.1:8317 HOME=/x", models), "C\tgpt");
});

test("cca reads CCA_ACCOUNT=<model id> as that model, over the pane's config dir too", () => {
  const models = JSON.stringify([{ id: "gemini", command: "gemini" }]);
  assert.equal(paneOut(() => "/usr/bin/claude CCA_ACCOUNT=gemini HOME=/x", models), "C\tgemini");
  assert.equal(paneOut((home) => `/usr/bin/claude CCA_ACCOUNT=gemini CLAUDE_CONFIG_DIR=${home}/.claude-accounts/work HOME=/x`, models),
    "C\tgemini");
});

test("cca names the current account from the pane's config dir", () => {
  assert.equal(paneOut((home) => `/usr/bin/claude CCA_ACCOUNT=work CLAUDE_CONFIG_DIR=${home}/.claude-accounts/work HOME=/x`),
    "C\twork");
});

test("cca reads a pane without markers as the default account", () => {
  assert.equal(paneOut(() => "/usr/bin/claude HOME=/x"), "C\tdefault");
});

test("the Codex usage reads the last event with a window and skips a cut line", () => {
  const line = (payload) => JSON.stringify({ type: "event_msg", payload });
  const text = [
    '{"type":"event_msg","payload":{"rate_', // the tail read can start mid-line
    line({ rate_limits: { primary: { used_percent: 1, resets_at: 10 }, secondary: null, plan_type: "plus" } }),
    line({ rate_limits: null }),
    codexEvent,
    line({ rate_limits: { primary: null, secondary: null, plan_type: "plus" } }),
  ].join("\n");
  assert.deepEqual(rateLimitsOf(text),
    { five: { used: 33, resets_at: 1794208378 }, seven: { used: 5, resets_at: 1794795178 }, plan: "plus" });
  assert.deepEqual(rateLimitsOf(line({ rate_limits: { secondary: { used_percent: 4.5 } } })),
    { five: null, seven: { used: 4.5, resets_at: null }, plan: null });
  assert.equal(rateLimitsOf(line({ rate_limits: null })), null);
  assert.equal(rateLimitsOf('{"type":"event_msg","payload":{"rate_'), null, "a cut line is skipped");
  assert.equal(rateLimitsOf(""), null);
});

test("codex-usage prints the rollout's five fields, and nothing when there is no data", () => {
  const home = mkdtempSync(join(tmpdir(), "codex-usage-"));
  try {
    const day = join(home, "sessions", "2026", "11", "09");
    mkdirSync(day, { recursive: true });
    writeFileSync(join(day, "rollout-x.jsonl"), `${codexEvent}\n`);
    const run = spawnSync(process.execPath, [codexUsage, home], { encoding: "utf8" });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "33\t1794208378\t5\t1794795178\tplus\n");

    const empty = mkdtempSync(join(tmpdir(), "codex-empty-"));
    try {
      mkdirSync(join(empty, "sessions"), { recursive: true });
      const none = spawnSync(process.execPath, [codexUsage, empty], { encoding: "utf8" });
      assert.equal(none.status, 0);
      assert.equal(none.stdout, "");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The shape /api/oauth/usage answered for an Ultra and a Max account on 2026-11-06, trimmed to the fields read.
test("the Fable week is read from the usage endpoint's weekly_scoped row", () => {
  const ultra = { five_hour: null, seven_day: { utilization: 9.0, resets_at: "2026-11-12T17:59:59.698736+00:00" },
    limits: [
      { kind: "weekly_all", group: "weekly", percent: 9, severity: "normal", resets_at: "2026-11-12T17:59:59.698736+00:00", scope: null, is_active: true },
      { kind: "weekly_scoped", group: "weekly", percent: 0, severity: "normal", resets_at: "2026-11-12T18:00:00+00:00",
        scope: { model: { id: null, display_name: "Fable" }, surface: null }, is_active: false },
    ] };
  assert.deepEqual(fableOf(ultra), { used: 0, resets_at: Date.parse("2026-11-12T18:00:00Z") / 1000 });
  const max = { limits: [
    { kind: "session", group: "session", percent: 4, resets_at: "2026-11-06T09:49:59.879011+00:00", scope: null },
    { kind: "weekly_scoped", group: "weekly", percent: 37, resets_at: "bad", scope: { model: { display_name: "fable" } } },
  ] };
  assert.deepEqual(fableOf(max), { used: 37, resets_at: null });
  assert.equal(fableOf({ limits: [{ kind: "weekly_scoped", percent: 5, scope: { model: { display_name: "Opus" } } }] }), null);
  assert.equal(fableOf({}), null);
});

test("usage-api exits 1 on unreadable credentials, also from a path a file URL would escape", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage api "));
  const copy = join(dir, "usage-api.mjs");
  copyFileSync(new URL("../mods/arcade-accounts/usage-api.mjs", import.meta.url), copy);
  try {
    const run = spawnSync(process.execPath, [copy], { input: "{bad", encoding: "utf8" });
    assert.equal(run.status, 1, "a silent exit 0 would let cca overwrite the last record with nothing");
    assert.equal(run.stdout, "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a custom command may keep the id codex, since only account folder names are cca commands", () => {
  const home = mkdtempSync(join(tmpdir(), "cca-models-codex-"));
  try {
    const text = JSON.stringify([{ id: "codex", label: "Codex", command: "claude-gpt" }]);
    assert.deepEqual(parseModels(text, { home }).map((m) => m.id), ["codex"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
