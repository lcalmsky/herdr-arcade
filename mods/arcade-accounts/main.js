// Fork of ~/git-repo/herdr-claude-accounts with the arcade-cards palette.
// Accounts for Herdr: the head shows two usage gauges for every Claude account, then a chip
// naming the focused agent's account, and the rail one pocket card per account. The popup lists
// the installed agent CLIs from knownAgents(), with the Claude and Codex account sub-lists under
// their own rows: the row starts that agent in a pane, an account row picks the login new sessions
// start under. Custom commands from models.json keep their own section, and the focused session
// can be resumed under another Claude account. The shell work lives in `cca`.
// props().role: "chip" draws the head, "rail" one pocket-card avatar per account for the bottom of a
// side rail, "menu" (or none, as mod.open gives) the accounts popup, and mode "add" the custom-
// command form.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, terminals, focused, run, exec, props, appHome, openOverlay, closeOverlay, knownAgents, shared } from "herdr";

const INK = {
  ink: "#191035", card: "#251b47", raised: "#191035", selected: "#31265a", line: "#483e74",
  t1: "#f1f0ff", t2: "#d0cdea", t3: "#aaa6c9", amber: "#ff41b4", amberHover: "#ff41b4", amberInk: "#f9d544",
  red: "#ff41b4", redInk: "#ff41b4", ring: "#483e74", buttonLine: "#483e74",
  track: "#31265a", workBand: "#003649", needsBand: "#670242",
};
const WINDOW_COLOR = { "5h": "#3adaf2", "7d": "#f9d544", Fable: "#ff41b4" };
// Window colours for text on the dark surfaces.
const WINDOW_INK = { "5h": "#3adaf2", "7d": "#f9d544", Fable: "#ff41b4" };
const FONT = "Galmuri11";
const DISPLAY = "Galmuri14";
const CREDIT_H = 18;
const FOCUS_WATCH_MS = 100;
// Below this the 76 px rail has no room for the shortcut beside CREDIT: it lives in the tooltip.
export const CREDIT_HINT_W = 110;
export function creditHintShown(railWidth) {
  return Number(railWidth) >= CREDIT_HINT_W;
}

// Account names go into a shell command line, so only these characters are accepted anywhere.
const ACCOUNT_NAME = /^[A-Za-z0-9_-]+$/;
const RESERVED = new Set(["ls", "add", "share", "help"]);
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Herdr has no API for a mod's own folder; the app home is where Herdr keeps mods.
const cca = () => `${appHome()}/mods/arcade-accounts/cca`;

// The command a resumed or new session starts with, editable in the popup. It lives next to cca's
// state so every copy of this mod (rail, popup, add form) reads the same value.
const LAUNCH_FILE = '"${XDG_STATE_HOME:-$HOME/.local/state}/herdr-tower/arcade-launch"';
const MODELS_FILE = '"${XDG_STATE_HOME:-$HOME/.local/state}/herdr-tower/models.json"';
const DEFAULT_LAUNCH = "claude";
const shellQuote = (s) => `'${s.replace(/'/g, "'\\''")}'`;

async function readLaunch() {
  try {
    const r = await exec("sh", ["-c", `cat ${LAUNCH_FILE} 2>/dev/null`]);
    return (r?.stdout ?? "").trim() || DEFAULT_LAUNCH;
  } catch {
    return DEFAULT_LAUNCH;
  }
}

// The porcelain record carries only whether a model can resume, so the template comes from the
// models file, indexed by id; the first usable entry wins, as in models.mjs.
export function resumeTemplates(text) {
  let list;
  try {
    list = JSON.parse(String(text ?? ""));
  } catch {
    return {};
  }
  if (!Array.isArray(list)) return {};
  const out = {};
  const seen = new Set();
  for (const entry of list) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    if (typeof entry.id !== "string" || !ACCOUNT_NAME.test(entry.id)) continue;
    if (typeof entry.command !== "string" || !entry.command.trim() || /[\t\r\n]/.test(entry.command)) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    if (typeof entry.resume === "string" && entry.resume.trim() && !/[\t\r\n]/.test(entry.resume)) {
      out[entry.id] = entry.resume.trim();
    }
  }
  return out;
}

async function modelResumes() {
  try {
    const r = await exec("sh", ["-c", `cat ${MODELS_FILE} 2>/dev/null`]);
    return resumeTemplates(r?.stdout);
  } catch {
    return {};
  }
}

// A command other than plain claude may be a shell function or alias (ccode), which only the
// user's interactive shell defines, so it runs through `$SHELL -ic`.
export const launchLine = (env, command, args) => (command === DEFAULT_LAUNCH
  ? `${env} exec claude${args}`
  : `${env} exec "\${SHELL:-/bin/zsh}" -ic ${shellQuote(command + args)}`);

// A model is a shell command of its own, so it ignores the saved start command and always runs
// through the interactive shell that defines it.
export function launchFor(name, args, command = DEFAULT_LAUNCH) {
  if (name && typeof name === "object") {
    return `unset CLAUDE_CONFIG_DIR; CCA_ACCOUNT=${name.name} exec "\${SHELL:-/bin/zsh}" -ic ${shellQuote(`${name.command}${args}`)}`;
  }
  // The default account must run with CLAUDE_CONFIG_DIR unset, or Claude Code reads ~/.claude/.claude.json.
  const env = name === "default"
    ? "unset CLAUDE_CONFIG_DIR; CCA_ACCOUNT=default"
    : `CLAUDE_CONFIG_DIR="$HOME/.claude-accounts/${name}" CCA_ACCOUNT=${name}`;
  return launchLine(env, command, args);
}

export function resumeArgs(target, id) {
  if (target?.kind === "model") {
    return target.resume ? ` ${target.resume.split("{id}").join(id)}` : null;
  }
  return ` --resume ${id}`;
}

// The display label cca keeps for an account, falling back to the account name.
const display = (a) => a?.label || a?.name || "";
// A failure line ends without a full stop and carries the next step in its fallback.
export const errorText = (r, fallback) => ((r?.stderr || r?.stdout) ?? "").trim().replace(/\.$/, "") || fallback;

// The CLI agents Herdr can start, Claude first and Codex second so an account sub-list sits under
// each; an entry with no installed flag was already filtered by the popup's props.
export function orderAgents(list) {
  if (!Array.isArray(list)) return [];
  const installed = list.filter((a) => a && typeof a.key === "string" && a.installed !== false);
  const pick = (key) => installed.filter((a) => a.key === key);
  return [...pick("claude"), ...pick("codex"), ...installed.filter((a) => a.key !== "claude" && a.key !== "codex")];
}

// A Codex agent runs under its active account's CODEX_HOME. A leading ~ stays outside the quotes
// so the shell expands it; the account name is validated, so the rest is safe to quote.
export function codexLaunch(dir, run) {
  const words = (Array.isArray(run) ? run : []).filter((w) => typeof w === "string" && w);
  const command = `exec ${words.map(shellQuote).join(" ")}`;
  if (!dir) return command;
  const path = String(dir);
  const target = path.startsWith("~/") ? `"$HOME"/${shellQuote(path.slice(2))}` : shellQuote(path);
  return `CODEX_HOME=${target} ${command}`;
}

// One pure read of cca's porcelain, so the menu, rail and chip all see the same lists.
export function parsePorcelain(text) {
  const out = {
    current: "default", globalDefault: "default", session: null,
    accounts: [], models: [], labels: {},
    codex: { active: "default", accounts: [] },
  };
  const byName = {};
  const codexByName = {};
  const win = (u, at) => (/^\d+(\.\d+)?$/.test(u ?? "")
    ? { used: Number(u), reset: /^\d+$/.test(at ?? "") ? Number(at) : null } : null);
  const codexAccount = (name) => {
    if (name !== "default" && !ACCOUNT_NAME.test(name ?? "")) return null;
    let c = codexByName[name];
    if (!c) {
      c = { name, email: "", usage: null, plan: null, label: null };
      codexByName[name] = c;
      out.codex.accounts.push(c);
    }
    return c;
  };
  // ~/.codex is always offered, whether or not cca reported it.
  codexAccount("default");
  for (const line of String(text ?? "").split("\n")) {
    if (!line) continue;
    const f = line.split("\t");
    const kind = f[0];
    const name = f[1];
    if (kind === "C" && name) out.current = name;
    else if (kind === "D" && ACCOUNT_NAME.test(name ?? "")) out.globalDefault = name;
    else if (kind === "A" && ACCOUNT_NAME.test(name ?? "")) {
      if (!byName[name]) {
        byName[name] = { name, email: (f[2] ?? "").trim(), usage: null, label: null, plan: null };
        out.accounts.push(byName[name]);
      }
    } else if (kind === "M" && ACCOUNT_NAME.test(name ?? "")) {
      if (!byName[name]) {
        byName[name] = { name, kind: "model", command: (f[2] ?? "").trim(), resumable: f[3] === "1",
          label: null, usage: null, plan: null, resume: null };
        out.models.push(byName[name]);
      }
    } else if (kind === "L" && name && (f[2] ?? "").trim()) {
      out.labels[name] = f[2].trim();
    } else if (kind === "U" && byName[name]) {
      byName[name].usage = { five: win(f[2], f[3]), seven: win(f[4], f[5]), fable: win(f[6], f[7]) };
    } else if (kind === "P" && byName[name]) {
      byName[name].plan = (f[2] ?? "").trim() || null;
    } else if (kind === "S" && SESSION_ID.test(name ?? "")) {
      out.session = { id: name, cwd: (f[2] ?? "").trim() };
    } else if (kind === "Y" && name && (name === "default" || ACCOUNT_NAME.test(name))) {
      out.codex.active = name;
    } else if (kind === "X") {
      const c = codexAccount(name);
      if (c) c.email = (f[2] ?? "").trim();
    } else if (kind === "V") {
      const c = codexAccount(name);
      if (c) c.usage = { five: win(f[2], f[3]), seven: win(f[4], f[5]), fable: null };
    } else if (kind === "Q") {
      const c = codexAccount(name);
      if (c) c.plan = (f[2] ?? "").trim() || null;
    }
  }
  for (const a of out.accounts) a.label = out.labels[a.name] ?? null;
  for (const m of out.models) m.label = out.labels[m.name] ?? null;
  for (const c of out.codex.accounts) c.label = out.labels[`codex:${c.name}`] ?? null;
  return out;
}

// The popup cannot resize after opening, so its height is the sum of the rows rendered from these
// lists: 12 px padding, a 24 px Agents header, one 40 px agent row each, the account sub-rows and
// their 28 px add rows, the 32 px Claude command row, a 24 px not-installed line, 13 px separators,
// the always-shown custom-command section, the resume section, and the 18 px hint line.
export function menuHeight({ agents = [], claudeAccounts = [], codexAccounts = [], models = [], resumeCount = 0, notInstalledCount = 0 } = {}) {
  const list = Array.isArray(agents) ? agents : [];
  const claude = list.some((a) => a?.key === "claude");
  const codex = list.some((a) => a?.key === "codex");
  const claudeList = Array.isArray(claudeAccounts) ? claudeAccounts : [];
  const codexList = Array.isArray(codexAccounts) ? codexAccounts : [];
  const modelList = Array.isArray(models) ? models : [];
  let height = 12 + 24 + list.length * 40;
  if (claude || claudeList.length) {
    height += claudeList.reduce((sum, a) => sum + accountRowHeight(a), 0);
    height += 28 + 32;
  }
  if (codex) {
    height += codexList.reduce((sum, a) => sum + accountRowHeight(a), 0);
    height += 28;
  }
  if (notInstalledCount > 0) height += 24;
  height += 13 + 24 + modelList.reduce((sum, m) => sum + accountRowHeight(m), 0) + 32;
  if (resumeCount > 0) height += 13 + 24 + resumeCount * 32;
  return height + 18;
}

// The popup's keys: ↑↓ move the highlight and wrap, ↩ and Space run the row shown, o opens the
// row shown in a new pane, and Esc cancels an open rename or start-command editor.
export function popupKey(key, at, count, editing) {
  if (key === "escape") return editing ? { at, cancelEdit: true, run: false, open: false } : null;
  if (editing || !(count > 0)) return null;
  if (key === "down") return { at: (at + 1) % count, cancelEdit: false, run: false, open: false };
  if (key === "up") return { at: (at - 1 + count) % count, cancelEdit: false, run: false, open: false };
  if (key === "enter" || key === "space") return { at: Math.min(at, count - 1), cancelEdit: false, run: true, open: false };
  if (key === "o") return { at: Math.min(at, count - 1), cancelEdit: false, run: false, open: true };
  return null;
}
// Pocket cards widen with the rail (16 px each side, up to the rail's max of 200 px in
// layouts/arcade.json) and spell the account out once there is room.
export const POCKET_FULL_W = 96;
export function pocketWidth(railWidth) {
  return Math.min(200 - 32, Math.max(44, Math.floor((Number(railWidth) || 0) - 32)));
}
// The card keeps the 44 × 52 proportion as it widens, and the "rail-accounts" block of
// layouts/arcade.json is resized to hold every card, 8 px apart and 8 px below.
export function pocketHeight(w) {
  return Math.round((w * 52) / 44);
}
export function pocketBlock(count, w) {
  return CREDIT_H + Math.max(1, count) * (pocketHeight(w) + 8) + 8;
}

// Herdr's JS engine ignores toLocaleDateString's weekday option and prints the whole date.
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A rate-limit window past its reset time is spent: it counts as 0 % and has no reset time to show.
const liveWindow = (w) => (w?.reset && w.reset * 1000 <= Date.now() ? { used: 0, reset: null } : w);

// Clock time within a day, else the weekday.
const resetLabel = (at) => {
  const d = new Date(at * 1000);
  return d - Date.now() < 86400000
    ? `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : WEEKDAYS[d.getDay()];
};

const USAGE_KEYS = { "5h": "five", "7d": "seven", Fable: "fable" };

// The two windows a card and the head show: Ultra has no 5h window, and its Fable week runs out first.
export function cardWindows(a) {
  const labels = /ultra/i.test(a?.plan ?? "") ? ["7d", "Fable"] : ["5h", "7d"];
  return labels.map((label) => [label, liveWindow(a?.usage?.[USAGE_KEYS[label]])]);
}

// The popup lists every window the account reports, and the card's two even before any usage is read.
export function popupWindows(a) {
  const card = cardWindows(a).map(([label]) => label);
  return Object.keys(USAGE_KEYS).filter((label) => card.includes(label) || a?.usage?.[USAGE_KEYS[label]])
    .map((label) => [label, liveWindow(a?.usage?.[USAGE_KEYS[label]])]);
}

const MODEL_WINDOWS = ["5h", "7d"];
export function modelWindows(a) {
  return MODEL_WINDOWS
    .map((label) => [label, liveWindow(a?.usage?.[USAGE_KEYS[label]])])
    .filter(([, w]) => w);
}

// "7d 9% ↻ Fri", or "5h –" before the window has any usage.
export function windowText([label, w]) {
  if (!w) return `${label} –`;
  const pct = Math.round(w.used);
  return w.reset ? `${label} ${pct}% ↻ ${resetLabel(w.reset)}` : `${label} ${pct}%`;
}

// The popup's account row: a 52 px head, then a 22 px bar per window and 8 px below them. A model
// with no usage spends that bar's space on one "usage not tracked" line.
export const accountRowHeight = (a) => (a?.kind === "model"
  ? 52 + Math.max(1, modelWindows(a).length) * 22 + 8
  : 52 + popupWindows(a).length * 22 + 8);

const resetIcon = (px, color = INK.t3) => svg("mods/arcade-accounts/reset.svg").size(px).flex_none().text_color(color);

// Characters by the account's place in cca's list, so a reorder for the focused pane keeps faces.
const CHARS = ["kid", "robot", "cat", "oldman", "frog", "punk"];
export const accountChar = (list, a) => CHARS[Math.max(0, list.indexOf(a)) % CHARS.length];

export default class ClaudeAccounts extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.role = p.role ?? "menu";
    this.width = 0;
    this.blockPx = null;
    this.accounts = p.accounts?.length ? p.accounts : [{ name: "default", email: "", usage: null }];
    this.agents = Array.isArray(p.agents) ? p.agents : null;
    this.notInstalled = Array.isArray(p.notInstalled) ? p.notInstalled : [];
    this.codex = p.codex ?? null;
    this.current = p.current ?? "default";
    this.globalDefault = p.globalDefault ?? "default";
    this.session = p.session ?? null;
    this.readError = p.error ?? null;
    this.hover = null;
    this.rename = null;
    this.renameError = null;
    this.addEdit = null;
    this.actionError = null;
    this.keyboard = false;
    if (this.role === "menu" && p.mode === "add") {
      this.cx = cx;
      this.nameInput = InputState.new({ value: "" });
      this.commandInput = InputState.new({ value: "" });
      this.nameInput.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      this.commandInput.on("change", (_e, cx) => { this.error = null; cx.notify(); });
      // There is no Tab handling on Input, so ↩ in the name moves on to the command while it is empty.
      this.nameInput.on("submit", () => {
        if (!(this.commandInput.value() ?? "").trim()) { this.commandInput.focus(); return; }
        this.addModel();
      });
      this.commandInput.on("submit", () => this.addModel());
      this.cancelHandle = cx.focus_handle();
      this.createHandle = cx.focus_handle();
      this.nameInput.focus();
      cx.timer.after(600, () => this.nameInput.focus());
      cx.timer.every(FOCUS_WATCH_MS, (cx) => this.watchFocus(cx));
      return;
    }
    if (this.role === "menu") {
      this.handle = cx.focus_handle();
      this.at = 0;
      this.launch = null;
      this.launchEdit = null;
      this.launchError = null;
      cx.timer.after(50, (cx) => { if (!this.rename && !this.addEdit && !this.launchEdit) this.handle.focus(); });
      cx.timer.every(FOCUS_WATCH_MS, (cx) => this.watchFocus(cx));
      cx.spawn(async (cx) => { this.launch = await readLaunch(); cx.notify(); });
    }
    if (!this.agents) {
      const cached = shared("new-menu.agents")?.[""];
      if (Array.isArray(cached)) this.agents = cached;
    }
    // knownAgents checks again at most once a minute; the menu needs the list before it opens.
    if (!Array.isArray(p.agents)) this.loadAgents(cx);
    cx.timer.every(60000, (cx) => this.loadAgents(cx));
    cx.timer.every(30000, (cx) => this.readAccounts(cx));
    this.readAccounts(cx);
  }

  loadAgents(cx) {
    cx.spawn(async (cx) => {
      let list = null;
      try { list = await knownAgents(); } catch {}
      if (!Array.isArray(list)) list = shared("new-menu.agents")?.[""];
      if (!Array.isArray(list)) return;
      this.agents = list;
      cx.notify();
    });
  }

  // The focused agent's pid when it is a local Claude Code process.
  focusedPid() {
    const f = focused();
    const a = agents().find((x) => x.focused || (f && (f.terminal === x.address || f.agent === x.address)));
    if (!a || a.address.includes("/")) return null;
    const t = terminals().find((x) => x.address === a.address);
    const claude = [t?.program?.key, t?.foreground?.name].some((n) => String(n ?? "").toLowerCase().includes("claude"));
    return claude ? t?.foreground?.pid ?? null : null;
  }

  readAccounts(cx, pid = this.focusedPid()) {
    if (this.readingAccounts) return;
    this.focusKey = pid == null ? "" : String(pid);
    const key = this.focusKey;
    this.readingAccounts = true;
    cx.spawn(async (cx) => {
      let r = null;
      try {
        r = await exec("sh", this.focusKey ? [cca(), "--porcelain", this.focusKey] : [cca(), "--porcelain"]);
      } catch {}
      const p = parsePorcelain(r?.stdout ?? "");
      const accounts = p.accounts;
      const models = p.models;
      const resumes = await modelResumes();
      for (const m of models) m.resume = resumes[m.name] ?? null;
      accounts.push(...models);
      this.readingAccounts = false;
      if (accounts.length) {
        this.readError = null;
        this.accounts = accounts;
        if (this.role === "rail") this.syncBlock();
        this.current = p.current;
        this.currentKey = key;
        this.globalDefault = p.globalDefault;
        this.session = p.session?.cwd ? p.session : null;
        this.codex = p.codex;
      } else if (!r || r.code === 127) {
        this.readError = `cca not found: ${cca()} — reinstall the accounts mod`;
      }
      cx.notify();
      // A focus change that landed during the read is picked up here, not on the 30 s timer.
      const now = this.focusedPid();
      if ((now == null ? "" : String(now)) !== this.focusKey) this.readAccounts(cx, now);
    });
  }

  // Opens the chosen account's Claude Code in a pane beside the focused one; running agents keep their own account.
  openAgent(name) {
    if (!ACCOUNT_NAME.test(name)) return;
    readLaunch().then((command) =>
      run("pane.split", { direction: "right", argv: ["sh", "-lc", launchFor(name, "", command)] }));
  }

  openModel(model) {
    if (!ACCOUNT_NAME.test(model?.name ?? "")) return;
    run("pane.split", { direction: "right", argv: ["sh", "-lc", launchFor(model, "")] });
  }

  // The Claude account new sessions open as: the global default when it names one, else default.
  claudeDefault() {
    const name = this.globalDefault ?? "default";
    const list = this.accounts ?? [];
    return list.some((a) => a.kind !== "model" && a.name === name) ? name : "default";
  }

  codexState() {
    const c = this.codex;
    const accounts = Array.isArray(c?.accounts) && c.accounts.length
      ? c.accounts
      : [{ name: "default", email: "", usage: null, plan: null, label: null }];
    const active = c?.active === "default" || ACCOUNT_NAME.test(c?.active ?? "") ? c.active : "default";
    return { active, accounts };
  }

  // An account's label, with the system login named for what it is when it has no label.
  subDisplay(a) {
    return a?.label || (a?.name === "default" ? "System default" : (a?.name ?? ""));
  }

  editing() {
    return Boolean(this.rename || this.addEdit || this.launchEdit);
  }

  // A Codex pane starts under one account's CODEX_HOME; only the active one is used from the row.
  openCodex(active = this.codexState().active) {
    const agent = (this.agents ?? []).find((a) => a?.key === "codex" && a.installed !== false);
    if (!agent || !Array.isArray(agent.run)) return;
    const dir = active === "default" ? null : `~/.codex-accounts/${active}`;
    closeOverlay(props().overlay);
    run("pane.split", { direction: "right", argv: ["sh", "-lc", codexLaunch(dir, agent.run)] });
  }

  launchAgent(a) {
    if (!a || this.editing()) return;
    if (a.key === "claude") {
      closeOverlay(props().overlay);
      this.openAgent(this.claudeDefault());
      return;
    }
    if (a.key === "codex") {
      this.openCodex();
      return;
    }
    if (!Array.isArray(a.run) || !a.run.length) return;
    closeOverlay(props().overlay);
    run("pane.split", { direction: "right", argv: a.run });
  }

  startAdd(kind, cx) {
    this.rename = null;
    this.renameError = null;
    this.launchEdit = null;
    this.launchError = null;
    this.actionError = null;
    this.hover = null;
    const input = InputState.new({ value: "" });
    input.on("submit", (_e, cx) => this.submitAdd(cx));
    this.addEdit = { kind, input };
    input.focus();
    cx.timer.after(300, () => { if (this.addEdit?.input === input) input.focus(); });
    cx.notify();
  }

  submitAdd(cx) {
    const edit = this.addEdit;
    if (!edit || this.adding) return;
    const name = (edit.input.value() ?? "").trim();
    const base = edit.kind === "codex" ? "~/.codex" : "~/.claude";
    if (!ACCOUNT_NAME.test(name)) { this.actionError = "Use letters, digits, - or _ only"; cx.notify(); return; }
    if (name === "default") { this.actionError = `default is the ${base} account — pick another name`; cx.notify(); return; }
    if (RESERVED.has(name) || name.startsWith("-")) { this.actionError = `${name} is a cca command — pick another name`; cx.notify(); return; }
    this.adding = true;
    this.actionError = null;
    cx.notify();
    if (edit.kind === "codex") this.createCodex(name, cx);
    else this.createClaude(name, cx);
  }

  createClaude(name, cx) {
    cx.spawn(async (cx) => {
      let r = null;
      try { r = await exec("sh", [cca(), "--porcelain-add", name]); } catch {}
      this.adding = false;
      if (!r || r.code !== 0) {
        this.actionError = errorText(r, "Could not create the account folder — check ~/.claude-accounts is writable");
        cx.notify();
        return;
      }
      this.addEdit = null;
      closeOverlay(props().overlay);
      this.openAgent(name);
    });
  }

  createCodex(name, cx) {
    cx.spawn(async (cx) => {
      let r = null;
      try { r = await exec("sh", [cca(), "--porcelain-add-codex", name]); } catch {}
      this.adding = false;
      if (!r || r.code !== 0) {
        this.actionError = errorText(r, "Could not create the account folder — check ~/.codex-accounts is writable");
        cx.notify();
        return;
      }
      const dir = (r.stdout ?? "").trim();
      this.addEdit = null;
      closeOverlay(props().overlay);
      const target = dir ? shellQuote(dir) : `"$HOME"/.codex-accounts/${name}`;
      run("pane.split", { direction: "right",
        argv: ["sh", "-lc", `CODEX_HOME=${target} codex login; exec $SHELL -l`] });
    });
  }

  addModel() {
    if (this.addingModel) return;
    const label = (this.nameInput?.value() ?? "").trim();
    const command = (this.commandInput?.value() ?? "").trim();
    if (/[\t\r\n]/.test(command)) { this.error = "The start command must be one line"; this.cx.notify(); return; }
    this.addingModel = true;
    this.error = null;
    this.cx.notify();
    this.cx.spawn(async (cx) => {
      let r = null;
      try { r = await exec("sh", [cca(), "--porcelain-add-model", label, command]); } catch {}
      this.addingModel = false;
      if (!r || r.code !== 0) {
        this.error = errorText(r, "Could not add the model — check the models file is writable");
        cx.notify();
        return;
      }
      closeOverlay(props().overlay);
      this.readAccounts(cx);
    });
  }

  avatar(name, size, font) {
    return div().size(size).flex_none().rounded(size / 2).bg(INK.raised).flex().items_center().justify_center()
      .text_size(font).font_family(FONT).font_bold().text_color(INK.t1).child([...(name || "?")][0]?.toUpperCase() ?? "?");
  }

  radio(on) {
    return h_flex().size(12).flex_none().rounded(0).border(2).border_color(on ? INK.amberInk : INK.ring)
      .items_center().justify_center().role("radio_button").aria_selected(on)
      .when(on, (el) => el.child(div().size(6).rounded(3).bg(INK.amber)));
  }

  accountChip() {
    const name = this.current ?? "default";
    const label = this.readError ? "?" : display(this.accounts.find((a) => a.name === name)) || name;
    return h_flex().id("head-accounts").h(26).flex_none().items_center().gap(6).pl(2).pr(10).rounded(0)
      .bg(INK.card).border(2).border_color(INK.line)
      .hover((h) => h.bg(INK.selected)).cursor_pointer().tooltip(this.readError ?? "Claude accounts")
      .on_click(() => this.openMenu())
      .child(this.avatar(label, 20, 11))
      .child(div().text_size(13).font_family(FONT).font_weight(600).text_color(INK.t1).child(label))
      .child(div().text_size(10).font_family(FONT).text_color(INK.t2).child("▾"));
  }

  openMenu() {
    const name = this.current ?? "default";
    const list = this.accounts?.length ? this.accounts : [{ name: "default", email: "", usage: null }];
    const resume = this.session ? list.filter((a) => a.name !== name && (a.kind !== "model" || a.resumable)) : [];
    const agents = orderAgents(this.agents).map((a) => ({
      key: a.key, name: a.name, icon: a.icon ?? null, tint: a.tint === true, run: Array.isArray(a.run) ? a.run : [],
    }));
    const notInstalled = (Array.isArray(this.agents) ? this.agents : [])
      .filter((a) => a && a.installed === false).map((a) => a.name).filter(Boolean);
    const codex = this.codexState();
    const height = this.readError ? 80 : Math.min(860, menuHeight({
      agents,
      claudeAccounts: list.filter((a) => a.kind !== "model"),
      codexAccounts: codex.accounts,
      models: list.filter((a) => a.kind === "model"),
      resumeCount: resume.length,
      notInstalledCount: notInstalled.length,
    }));
    openOverlay({ mod: "arcade-accounts", kind: "popup", width: 460, height,
      props: { role: "menu", current: name, globalDefault: this.globalDefault ?? "default",
        accounts: list, session: this.session, error: this.readError ?? null,
        agents, notInstalled, codex } });
  }

  // The block is as wide as the layout says; the chip keeps its place at the right end of the head.
  chip(cx) {
    const pid = this.focusedPid();
    if ((pid == null ? "" : String(pid)) !== this.focusKey) this.readAccounts(cx, pid);
    const list = this.accounts?.length ? this.accounts : [{ name: "default", email: "", usage: null }];
    const groups = [];
    for (const a of list) {
      if (groups.length) groups.push(div().w(1).h(16).flex_none().bg(INK.line));
      groups.push(this.accountGauges(a));
    }
    return h_flex().size_full().items_center().justify_end().pr(20).gap(16)
      .children(groups)
      .child(this.accountChip());
  }

  accountGauges(a) {
    const me = a.name === this.current;
    return h_flex().flex_none().items_center().gap(8)
      .child(div().flex_none().text_size(12).font_family(FONT).font_bold().text_color(me ? INK.t1 : INK.t3).child(display(a)))
      .children(cardWindows(a).map(([label, w]) => this.gauge(a, label, w)));
  }

  // One rate-limit window as a fuel gauge: a 44 px bar with quarter ticks, the percentage and,
  // from 90 %, the reset time in red (clock time within a day, else the weekday).
  gauge(a, label, w) {
    const pct = w ? Math.min(100, Math.round(w.used)) : null;
    const hot = pct != null && pct >= 90;
    const when = w?.reset ? resetLabel(w.reset) : null;
    return h_flex().flex_none().gap(4).items_center()
      .tooltip(`${display(a)} ${label} window${pct == null ? ": no usage yet" : ` ${pct}% used`}`)
      .child(div().text_size(11).font_family(FONT).font_bold().text_color(INK.t3).child(label))
      .child(div().relative().w(44).h(4).rounded(2).bg(INK.line).overflow_hidden()
        .child(div().absolute().left(0).top(0).bottom(0).w(Math.round(((pct ?? 0) / 100) * 44)).rounded(2)
          .bg(WINDOW_COLOR[label]))
        .children([11, 22, 33].map((x) => div().absolute().left(x).top(0).bottom(0).w(1).bg(INK.line))))
      .child(div().flex_none().text_size(12).font_family("Geist Mono")
        .text_color(hot ? INK.redInk : a.name === this.current ? INK.t1 : INK.t2)
        .child(pct == null ? "–" : `${pct}%`))
      .when(Boolean(hot && when), (el) => el.child(resetIcon(12)).child(div().flex_none().text_size(12)
        .font_family("Geist Mono").text_color(INK.t3).child(when)));
  }

  // One 22 px line per window under the account's name: label and bar in the window's colour, the
  // percentage (red from 90 %) and the reset time.
  usageBars(a, hint = INK.t3) {
    return this.windowBars(popupWindows(a), hint);
  }

  modelUsageBars(m) {
    const windows = modelWindows(m);
    if (!windows.length) {
      return v_flex().w_full().flex_none().pl(54).pr(10).pb(8)
        .child(div().h(22).w_full().flex().items_center().text_size(11).font_family("Geist Mono")
          .text_color(INK.t3).child("usage not tracked"));
    }
    return this.windowBars(windows, INK.t3);
  }

  windowBars(windows, hint) {
    const mono = (text, color = hint) => div().flex_none().text_size(12).font_family("Geist Mono").text_color(color).child(text);
    return v_flex().w_full().flex_none().pl(54).pr(10).pb(8)
      .children(windows.map(([label, w]) => {
        const pct = w ? Math.min(100, Math.max(0, Math.round(w.used))) : null;
        const hot = pct != null && pct >= 90;
        return h_flex().h(22).w_full().items_center().gap(10)
          .child(div().w(40).flex_none().text_size(12).font_family(FONT).font_bold().text_color(WINDOW_INK[label]).child(label))
          .child(div().flex_1().min_w(0).h(8).rounded(4).bg(INK.track).overflow_hidden()
            .child(div().h_full().w(`${pct ?? 0}%`).rounded(4).bg(WINDOW_COLOR[label])))
          .child(div().w(40).flex_none().flex().justify_end()
            .child(mono(pct == null ? "–" : `${pct}%`, hot ? INK.redInk : INK.t1)))
          // Geist Mono has no ↻, and the fallback font draws it garbled, so the arrow is an icon.
          .child(h_flex().w(52).flex_none().gap(2).items_center()
            .when(Boolean(w?.reset), (el) => el.child(resetIcon(11, hint)).child(mono(resetLabel(w.reset)))));
      }));
  }

  // A 40 px avatar per account, stacked from the bottom: one ring per rate-limit window, the 5h
  // window outside. Every track is drawn in full so each avatar keeps the same outer edge. The
  // focused Claude Code pane's account goes on top with an amber disc and a light letter; otherwise
  // the letter is bright only on the account new sessions open as.
  rail(cx) {
    const pid = this.focusedPid();
    if ((pid == null ? "" : String(pid)) !== this.focusKey) this.readAccounts(cx, pid);
    const list = this.accounts?.length ? this.accounts : [{ name: "default", email: "", usage: null }];
    // Without a focused Claude Code pane there is no "this pane" account to mark, and `current`
    // counts only once a read for the pane focused now has come back.
    const here = this.focusKey && this.currentKey === this.focusKey ? this.current : null;
    const ordered = [...list.filter((a) => a.name === here), ...list.filter((a) => a.name !== here)];
    const w = pocketWidth(this.width);
    return v_flex().id("rail-pockets").size_full().items_center().gap(8).pb(8)
      .on_size_change((size, cx) => {
        if (size.width === this.width) return;
        this.width = size.width;
        this.syncBlock();
        cx.notify();
      })
      .child(h_flex().w_full().h(CREDIT_H).flex_none().px(8).justify_between().items_center()
        .tooltip("CREDIT · ctrl shift A")
        .child(div().text_size(12).font_family(DISPLAY).text_color(INK.amberInk).child("CREDIT"))
        .when(creditHintShown(this.width), (el) => el.child(div().text_size(9).font_family(FONT).text_color(INK.t3).child("ctrl shift A"))))
      .child(div().flex_1())
      .children(ordered.map((a) => this.pocketAvatar(a, a.name === here, accountChar(list, a), w)));
  }

  // The CREDIT panel: every account a vertical row with its two rate-limit windows as pip bars.
  // The focused pane's account is marked; a click opens the same popup as ctrl-shift-a.
  board(cx) {
    const pid = this.focusedPid();
    if ((pid == null ? "" : String(pid)) !== this.focusKey) this.readAccounts(cx, pid);
    const list = this.accounts?.length ? this.accounts : [{ name: "default", email: "", usage: null }];
    const here = this.focusKey && this.currentKey === this.focusKey ? this.current : null;
    const bar = (label, w) => {
      const pct = w ? Math.min(100, Math.max(0, Math.round(w.used))) : 0;
      return h_flex().h(10).flex_none().gap(2).items_center()
        .child(div().w(32).flex_none().truncate().text_size(9).font_family(DISPLAY).text_color(INK.t2).child(label))
        .child(h_flex().flex_1().min_w(0).gap(2).children(Array.from({ length: 10 }, (_, i) => div().flex_1().h(6)
          .bg(pct >= (i + 1) * 10 ? WINDOW_COLOR[label] : INK.track))))
        .child(div().w(28).flex_none().text_size(9).font_family(FONT).text_color(INK.t2).child(`${pct}%`));
    };
    const row = (a) => v_flex().id(`credit-${a.name}`).flex_none().gap(2).px(2).py(4).rounded(0).cursor_pointer()
      .hover((h) => h.bg(INK.selected))
      .tooltip([display(a), ...cardWindows(a).map(windowText), a.name === here ? "this pane" : null].filter(Boolean).join(" · "))
      .on_click(() => this.openMenu())
      .child(h_flex().min_w(0).gap(4).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).font_family(FONT).font_weight(800)
          .text_color(a.name === (this.globalDefault ?? "default") ? INK.t1 : INK.t2).child(display(a) || "?"))
        .when(a.name === here, (el) => el.child(div().flex_none().text_size(9).font_family(DISPLAY)
          .text_color(INK.amberInk).child("this pane"))))
      .children(cardWindows(a).map(([label, w]) => bar(label, w)));
    return v_flex().id("credit-board").size_full().p(8).gap(6).bg(INK.card).border(2).border_color(INK.line)
      .child(div().flex_none().text_size(12).font_family(DISPLAY).text_color(INK.amberInk).child("CREDIT"))
      .child(v_flex().flex_1().min_h(0).gap(8).overflow_y_scroll().children(list.map(row)));
  }

  syncBlock() {
    const px = pocketBlock(this.accounts?.length ?? 1, pocketWidth(this.width));
    if (px === this.blockPx) return;
    this.blockPx = px;
    run("layout.resize", { id: "rail-accounts", px });
  }

  // A pocket card like the strip's: the character on a band (pink once a window passes 90 %),
  // then the card's two window bars. The focused pane's account takes the selected card's 2 px amber border.
  pocketAvatar(a, here, who, w = 44) {
    const windows = cardWindows(a);
    const pcts = windows.map(([, w]) => (w ? Math.min(100, Math.max(0, w.used)) : 0));
    const tip = [display(a), ...windows.map(windowText)].join(" · ");
    const bright = a.name === (this.globalDefault ?? "default");
    const hot = pcts.some((pct) => pct >= 90);
    const bar = (pct, i) => h_flex().h(4).mt(4).w_full().gap(2)
      .children(Array.from({ length: 10 }, (_, pip) => div().flex_1().h(4)
        .bg(pct >= (pip + 1) * 10 ? WINDOW_COLOR[windows[i][0]] : INK.track)));
    const height = pocketHeight(w);
    const profile = w >= POCKET_FULL_W;
    // Padding and border come to 8 px either way: 2 + 2 when it is this pane's account, 3 + 1 otherwise.
    const band = profile ? height - 8 - 16 - 20 : height - 26;
    const art = profile
      ? image(`mods/arcade-cards/chars/${who}.png`).size(Math.min(band - 8, w - 24))
      : image(`mods/arcade-rail/faces/${who}.png`).size(band - 4);
    const initial = [...(display(a) || "?")][0]?.toUpperCase() ?? "?";
    return v_flex().id(`rail-acct-${a.name}`).w(w).h(height).flex_none().p(here ? 2 : 3).rounded(0).cursor_pointer()
      .bg(INK.card).border(here ? 2 : 1).border_color(here ? INK.amberInk : INK.line)
      .when(!here, (el) => el.hover((h) => h.border_color(INK.ring)))
      .tooltip(this.readError ?? `${tip}${here ? " · this pane" : ""}${bright ? " · new sessions" : ""}`)
      .on_click(() => this.openMenu())
      .child(div().relative().h(band).w_full().flex_none().rounded(0).bg(hot ? INK.needsBand : INK.workBand)
        .flex().items_end().when(profile, (el) => el.justify_center()).when(!profile, (el) => el.justify_end().pr(2))
        .child(art)
        .when(!profile, (el) => el.child(div().absolute().left(4).top(2).text_size(9).font_family(FONT).font_weight(800)
          .text_color(bright ? INK.t1 : INK.t3).child(initial))))
      .when(profile, (el) => el.child(div().h(20).flex_none().pt(4).px(2).truncate().text_size(12).font_family(FONT)
        .font_weight(800).text_color(bright ? INK.t1 : INK.t3).child(display(a) || "?")))
      .children(pcts.map(bar));
  }

  // Resumes the focused agent's session under another account or model in a new pane; the old one
  // keeps running.
  continueAs(target, session) {
    const model = target && typeof target === "object" && target.kind === "model" ? target : null;
    const name = model ? model.name : target;
    if (!ACCOUNT_NAME.test(name ?? "") || !SESSION_ID.test(session?.id ?? "") || !session?.cwd) return;
    const args = resumeArgs(model, session.id);
    if (!args) return;
    // pane.split takes no folder, so the shell changes into the session's cwd first.
    const cwd = `'${session.cwd.replace(/'/g, "'\\''")}'`;
    if (model) {
      run("pane.split", { direction: "right", argv: ["sh", "-lc", `cd ${cwd} && ${launchFor(model, args)}`] });
      return;
    }
    readLaunch().then((command) => run("pane.split", { direction: "right",
      argv: ["sh", "-lc", `cd ${cwd} && ${launchFor(name, args, command)}`] }));
  }

  startLaunchEdit(cx) {
    this.rename = null;
    this.renameError = null;
    this.addEdit = null;
    this.launchError = null;
    const input = InputState.new({ value: this.launch ?? DEFAULT_LAUNCH });
    input.on("submit", (_e, cx) => this.saveLaunch(cx));
    this.launchEdit = { input };
    input.focus();
    cx.timer.after(300, () => { if (this.launchEdit?.input === input) input.focus(); });
    cx.notify();
  }

  saveLaunch(cx) {
    const edit = this.launchEdit;
    if (!edit || this.savingLaunch) return;
    const value = (edit.input.value() ?? "").trim() || DEFAULT_LAUNCH;
    if (/[\n\r]/.test(value)) { this.launchError = "One line only — the command runs in a shell"; cx.notify(); return; }
    this.savingLaunch = true;
    cx.spawn(async (cx) => {
      let res = null;
      try {
        res = await exec("sh", ["-c", `f=${LAUNCH_FILE}; mkdir -p "$(dirname "$f")" && printf '%s\\n' "$1" > "$f"`, "x", value]);
      } catch {}
      this.savingLaunch = false;
      if (!res || res.code !== 0) {
        this.launchError = errorText(res, "Could not save the command — check the state folder is writable");
        cx.notify();
        return;
      }
      this.launch = value;
      this.launchEdit = null;
      this.handle.focus();
      cx.notify();
    });
  }

  // Makes the account new sessions start under; the popup stays open so the radio follows.
  useAccount(name, cx) {
    if (!ACCOUNT_NAME.test(name) || this.usingAccount) return;
    this.usingAccount = true;
    this.actionError = null;
    cx.spawn(async (cx) => {
      let r = null;
      try { r = await exec("sh", [cca(), "use", name]); } catch {}
      this.usingAccount = false;
      if (!r || r.code !== 0) {
        this.actionError = errorText(r, "Could not change the default account — check cca and retry");
        cx.notify();
        return;
      }
      this.readAccounts(cx);
      cx.notify();
    });
  }

  // The Codex half of useAccount; the popup stays open so the radio follows.
  useCodex(name, cx) {
    if (!ACCOUNT_NAME.test(name) || this.usingCodex) return;
    this.usingCodex = true;
    this.actionError = null;
    cx.spawn(async (cx) => {
      let r = null;
      try { r = await exec("sh", [cca(), "codex", "use", name]); } catch {}
      this.usingCodex = false;
      if (!r || r.code !== 0) {
        this.actionError = errorText(r, "Could not change the Codex account — check cca and retry");
        cx.notify();
        return;
      }
      this.readAccounts(cx);
      cx.notify();
    });
  }

  startRename(a, cx, key = a.name) {
    this.actionError = null;
    this.launchEdit = null;
    this.launchError = null;
    this.addEdit = null;
    this.renameError = null;
    this.hover = null;
    const input = InputState.new({ value: a.label || a.name || "" });
    input.on("submit", (_e, cx) => this.saveRename(cx));
    this.rename = { key, name: a.name, input };
    input.focus();
    cx.timer.after(300, () => { if (this.rename?.input === input) input.focus(); });
    cx.notify();
  }

  saveRename(cx) {
    const r = this.rename;
    if (!r || this.savingRename) return;
    const value = (r.input.value() ?? "").trim();
    this.savingRename = true;
    this.renameError = null;
    cx.spawn(async (cx) => {
      let res = null;
      try { res = await exec("sh", [cca(), "--porcelain-rename", r.key, value]); } catch {}
      this.savingRename = false;
      if (!res || res.code !== 0) {
        this.renameError = errorText(res, "Could not rename the account — try another name");
        cx.notify();
        return;
      }
      this.rename = null;
      this.readAccounts(cx);
      cx.notify();
    });
  }

  // readAccounts keeps the focused pane's pid in this.focusKey, so the ring's key has its own name.
  ringKey() {
    return `${this.keyboard ? 1 : 0}|${[this.handle, this.cancelHandle, this.createHandle]
      .map((handle) => (handle?.is_focused?.() ? 1 : 0)).join("")}`;
  }

  // A ring comes from is_focused(), and the shell redraws only on notify or reload; only the
  // keyboard draws it, since a click focuses the popup too.
  watchFocus(cx) {
    const key = this.ringKey();
    if (key === this.drawnFocus) return;
    this.drawnFocus = key;
    cx.notify();
  }

  focusedAt(index) {
    return this.keyboard && index === this.at && Boolean(this.handle?.is_focused?.());
  }

  accountsMenu() {
    if (this.readError) {
      return v_flex().id("accounts-menu").w_full().h_full().min_h(0).p(6).overflow_y_scroll()
        .child(div().px(8).py(6).text_size(11).font_family(FONT).text_color(INK.redInk).child(this.readError));
    }
    const cur = this.current ?? "default";
    const list = this.accounts?.length ? this.accounts : [{ name: "default", email: "", usage: null }];
    const claudeAccounts = list.filter((a) => a.kind !== "model");
    const models = list.filter((a) => a.kind === "model");
    const codex = this.codexState();
    const agents = orderAgents(this.agents);
    const knownNotInstalled = (Array.isArray(this.agents) ? this.agents : [])
      .filter((a) => a && a.installed === false).map((a) => a.name).filter(Boolean);
    const notInstalled = knownNotInstalled.length ? knownNotInstalled : this.notInstalled;
    const resume = this.session
      ? list.filter((a) => a.name !== cur && (a.kind !== "model" || a.resumable))
      : [];
    const focusRows = [];

    const rows = [];
    let claudeShown = false;
    for (const a of agents) {
      rows.push(this.agentRow(a, focusRows));
      if (a.key === "claude") {
        claudeShown = true;
        for (const acct of claudeAccounts) rows.push(this.accountRow(acct, "claude", focusRows));
        rows.push(this.addAccountRow("claude", focusRows));
        rows.push(this.launchRow(focusRows));
      } else if (a.key === "codex") {
        for (const acct of codex.accounts) rows.push(this.accountRow(acct, "codex", focusRows));
        rows.push(this.addAccountRow("codex", focusRows));
      }
    }
    // The Claude accounts stay listed even when Herdr cannot start Claude itself.
    if (!claudeShown && claudeAccounts.length) {
      for (const acct of claudeAccounts) rows.push(this.accountRow(acct, "claude", focusRows));
      rows.push(this.addAccountRow("claude", focusRows));
      rows.push(this.launchRow(focusRows));
    }
    if (notInstalled.length) {
      rows.push(div().h(24).px(8).flex().items_center().truncate().text_size(11).font_family(FONT).text_color(INK.t3)
        .child(`Not installed: ${notInstalled.join(", ")}`));
    }

    const root = v_flex().id("accounts-menu").w_full().h_full().min_h(0).p(6).overflow_y_scroll()
      .track_focus(this.handle).tab_index(0)
      .on_mouse_down("left", () => { this.keyboard = false; })
      .on_key_down((e, cx) => {
        const next = popupKey(e.key, this.at, focusRows.length, this.editing());
        if (!next) return;
        cx.stop_propagation();
        if (next.cancelEdit) {
          this.rename = null;
          this.renameError = null;
          this.addEdit = null;
          this.launchEdit = null;
          this.launchError = null;
          this.actionError = null;
          this.handle.focus();
          cx.notify();
          return;
        }
        this.keyboard = true;
        this.at = next.at;
        cx.notify();
        if (next.run) focusRows[this.at]?.run(cx);
        else if (next.open) focusRows[this.at]?.open?.(cx);
      })
      .child(div().h(24).px(8).flex().items_center().text_size(11).font_family(FONT).font_weight(600).text_color(INK.t3)
        .child("Agents"))
      .children(rows);
    root.child(div().h(1).mx(2).my(6).bg(INK.line))
      .child(div().h(24).px(8).flex().items_center().text_size(11).font_family(FONT).font_weight(600).text_color(INK.t3)
        .child("Custom commands"))
      .children(models.map((m) => this.customRow(m, focusRows)))
      .child(this.addCustomRow(focusRows));
    if (resume.length) {
      root.child(div().h(1).mx(2).my(6).bg(INK.line))
        .child(div().h(24).px(8).flex().items_center().text_size(11).font_family(FONT).font_weight(600).text_color(INK.t3)
          .child("Continue this session as"))
        .children(resume.map((a) => this.resumeRow(a, focusRows)));
    }
    return root.child(this.hintRow(this.menuHint()));
  }

  menuHint() {
    if (this.actionError) return { text: this.actionError, error: true };
    if (this.renameError) return { text: this.renameError, error: true };
    if (this.launchError) return { text: this.launchError, error: true };
    if (this.rename) return { text: "↩ save · esc cancel" };
    if (this.addEdit) return { text: "↩ create · esc cancel" };
    if (this.launchEdit) return { text: "↩ save · esc cancel · empty = claude" };
    return null;
  }

  hintRow(hint) {
    return div().h(18).px(8).flex().items_center().truncate()
      .text_size(hint?.error ? 11 : 10)
      .font_family(hint?.error ? FONT : "Geist Mono")
      .text_color(hint?.error ? INK.redInk : INK.t3)
      .child(hint?.text ?? "");
  }

  agentRow(a, focusRows) {
    const at = focusRows.push({ run: () => this.launchAgent(a), open: () => this.launchAgent(a) }) - 1;
    const icon = a.icon
      ? (a.tint ? svg(a.icon).size(16).text_color(INK.t1) : image(a.icon).size(16))
      : div().size(16).flex_none();
    const paneButton = h_flex().id(`pane-agent-${a.key}`).h(18).flex_none().items_center().px(4).rounded(0)
      .cursor_pointer().role("button").accessibility_label(`Open ${a.name} in a new pane`)
      .tooltip(`Open ${a.name} in a new pane`)
      .on_click((_e, cx) => { cx.stop_propagation(); this.launchAgent(a); })
      .child(div().text_size(11).font_family("Geist Mono").text_color(INK.t2)
        .hover((h) => h.underline()).child("new pane"));
    return h_flex().id(`agent-${a.key}`).h(40).flex_none().px(8).gap(10).rounded(0).items_center().cursor_pointer()
      .when(this.focusedAt(at), (el) => el.border(2).border_color(INK.amberInk))
      .role("button").accessibility_label(`Start ${a.name} in a new pane`)
      .hover((h) => h.bg(INK.selected))
      .tooltip(`Start ${a.name} in a new pane`)
      .on_click(() => this.launchAgent(a))
      .child(icon)
      .child(div().flex_1().min_w(0).truncate().text_size(14).font_family(FONT).font_bold().text_color(INK.t1).child(a.name))
      .child(paneButton);
  }

  accountRow(a, kind, focusRows) {
    const codex = kind === "codex";
    const key = codex ? `codex:${a.name}` : a.name;
    const on = codex ? a.name === this.codexState().active : a.name === this.claudeDefault();
    if (this.rename?.key === key) return this.renameRow(a, key, on, true);
    const tag = !codex && a.name === (this.current ?? "default");
    const hovered = this.hover === key;
    const select = (cx) => (codex ? this.useCodex(a.name, cx) : this.useAccount(a.name, cx));
    const open = () => {
      closeOverlay(props().overlay);
      if (codex) this.openCodex(a.name);
      else this.openAgent(a.name);
    };
    const at = focusRows.push({ run: (cx) => select(cx), open }) - 1;
    return v_flex().id(`acct-${key}`).w_full().flex_none().rounded(0).cursor_pointer().pl(30).pr(8)
      .when(this.focusedAt(at), (el) => el.border(2).border_color(INK.amberInk))
      .role("button").accessibility_label(`New ${codex ? "Codex " : ""}sessions open as ${this.subDisplay(a)}`)
      .hover((h) => h.bg(INK.selected))
      .on_hover((shown, cx) => {
        if (shown) this.hover = key;
        else if (this.hover === key) this.hover = null;
        cx.notify();
      })
      .tooltip(`New ${codex ? "Codex " : ""}sessions open as ${this.subDisplay(a)}`)
      .on_click((_e, cx) => { if (!this.editing()) select(cx); })
      .child(h_flex().h(52).flex_none().gap(8).items_center()
        .child(div().w(14).flex_none().flex().justify_center().child(this.radio(on)))
        .child(this.avatar(this.subDisplay(a), 20, 10))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().w_full().gap(8).items_center().min_w(0)
            .child(div().flex_none().truncate().text_size(13).font_family(FONT).font_bold().text_color(INK.t1)
              .child(this.subDisplay(a)))
            .when(tag, (el) => el.child(div().flex_none().text_size(11).font_family("Geist Mono")
              .text_color(INK.t2).child("this pane"))))
          .child(div().truncate().text_size(12).font_family("Geist Mono").text_color(INK.t2)
            .child(a.email || "not signed in")))
        .child(h_flex().w(16).flex_none().items_center()
          .when(hovered, (el) => el.child(h_flex().id(`pen-${key}`).size(16).flex_none().items_center()
            .justify_center().cursor_pointer()
            .on_click((_e, cx) => { cx.stop_propagation(); this.startRename(a, cx, key); })
            .child(svg("mods/arcade-accounts/pencil.svg").size(16).flex_none().text_color(INK.t2))))))
      .child(this.usageBars(a));
  }

  renameRow(a, key, on, withRadio) {
    return v_flex().id(`acct-${key}`).w_full().flex_none().rounded(0).bg(INK.selected)
      .pl(withRadio ? 30 : 8).pr(8)
      .child(h_flex().h(52).flex_none().gap(8).items_center()
        .when(withRadio, (el) => el.child(div().w(14).flex_none().flex().justify_center().child(this.radio(on))))
        .child(this.avatar(a.label || a.name, withRadio ? 20 : 24, withRadio ? 10 : 11))
        .child(Input.new(this.rename.input).h(28).flex_1().min_w(0).rounded(0).border(2)
          .border_color(INK.amberInk).bg(INK.raised).text_size(13).font_family(FONT).font_bold().text_color(INK.t1)))
      .child(a.kind === "model" ? this.modelUsageBars(a) : this.usageBars(a, INK.t2));
  }

  addAccountRow(kind, focusRows) {
    const codex = kind === "codex";
    const id = codex ? "acct-add-codex" : "acct-add-claude";
    const text = codex ? "+ Add Codex account" : "+ Add Claude account";
    if (this.addEdit?.kind === kind) {
      return h_flex().id(id).h(28).flex_none().pl(30).pr(8).items_center()
        .child(Input.new(this.addEdit.input).h(24).flex_1().min_w(0).rounded(0).border(2)
          .border_color(INK.amberInk).bg(INK.raised).text_size(12).font_family("Geist Mono").text_color(INK.t1));
    }
    const at = focusRows.push({ run: (cx) => this.startAdd(kind, cx) }) - 1;
    return h_flex().id(id).h(28).flex_none().pl(30).pr(8).rounded(0).items_center().cursor_pointer()
      .when(this.focusedAt(at), (el) => el.border(2).border_color(INK.amberInk))
      .role("button").accessibility_label(text.replace("+ ", ""))
      .hover((h) => h.bg(INK.selected))
      .on_click((_e, cx) => { if (!this.editing()) this.startAdd(kind, cx); })
      .child(div().text_size(12).font_family(FONT).font_weight(600).text_color(INK.t2).child(text));
  }

  customRow(m, focusRows) {
    if (this.rename?.key === m.name) return this.renameRow(m, m.name, false, false);
    const hovered = this.hover === m.name;
    const open = () => { closeOverlay(props().overlay); this.openModel(m); };
    const at = focusRows.push({ run: open, open }) - 1;
    const paneButton = h_flex().id(`pane-${m.name}`).h(18).flex_none().items_center().px(4).rounded(0)
      .cursor_pointer().role("button").accessibility_label(`Open ${display(m)} in a new pane`)
      .tooltip(`Open ${display(m)} in a new pane`)
      .on_click((_e, cx) => { cx.stop_propagation(); open(); })
      .child(div().text_size(11).font_family("Geist Mono").text_color(INK.t2)
        .hover((h) => h.underline()).child("new pane"));
    return v_flex().id(`acct-${m.name}`).w_full().flex_none().rounded(0).cursor_pointer().px(8)
      .when(this.focusedAt(at), (el) => el.border(2).border_color(INK.amberInk))
      .role("button").accessibility_label(`Start ${display(m)} in a new pane`)
      .hover((h) => h.bg(INK.selected))
      .on_hover((shown, cx) => {
        if (shown) this.hover = m.name;
        else if (this.hover === m.name) this.hover = null;
        cx.notify();
      })
      .tooltip(`Start ${display(m)} in a new pane`)
      .on_click(() => { if (!this.editing()) open(); })
      .child(h_flex().h(52).flex_none().gap(8).items_center()
        .child(this.avatar(display(m), 24, 11))
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(h_flex().w_full().gap(8).items_center().min_w(0)
            .child(div().flex_none().text_size(14).font_family(FONT).font_bold().text_color(INK.t1).child(display(m)))
            .child(h_flex().flex_1().min_w(0).justify_end().child(paneButton)))
          .child(div().truncate().text_size(12).font_family("Geist Mono").text_color(INK.t2).child(m.command || "?")))
        .child(h_flex().w(16).flex_none().items_center()
          .when(hovered, (el) => el.child(h_flex().id(`pen-${m.name}`).size(16).flex_none().items_center()
            .justify_center().cursor_pointer()
            .on_click((_e, cx) => { cx.stop_propagation(); this.startRename(m, cx); })
            .child(svg("mods/arcade-accounts/pencil.svg").size(16).flex_none().text_color(INK.t2))))))
      .child(this.modelUsageBars(m));
  }

  addCustomRow(focusRows) {
    const open = () => {
      closeOverlay(props().overlay);
      openOverlay({ mod: "arcade-accounts", kind: "popup", width: 340, height: 340, props: { mode: "add" } });
    };
    const at = focusRows.push({ run: open }) - 1;
    return h_flex().id("custom-add").h(32).flex_none().pl(30).pr(8).rounded(0).items_center().cursor_pointer()
      .when(this.focusedAt(at), (el) => el.border(2).border_color(INK.amberInk))
      .role("button").accessibility_label("Add custom command")
      .hover((h) => h.bg(INK.selected))
      .on_click(open)
      .child(div().text_size(12).font_family(FONT).font_weight(600).text_color(INK.t2).child("+ Add custom command…"));
  }

  resumeRow(a, focusRows) {
    const at = focusRows.push({ run: () => { closeOverlay(props().overlay); this.continueAs(a, this.session); } }) - 1;
    return h_flex().id(`cont-${a.name}`).h(32).flex_none().px(8).rounded(0).gap(8).items_center().cursor_pointer()
      .when(this.focusedAt(at), (el) => el.border(2).border_color(INK.amberInk))
      .role("button").accessibility_label(`Resume this session as ${display(a)}`)
      .hover((h) => h.bg(INK.selected)).tooltip(`Resume this session as ${display(a)}`)
      .on_click(() => { closeOverlay(props().overlay); this.continueAs(a, this.session); })
      .child(div().w(14).flex_none())
      .child(this.avatar(display(a), 20, 10))
      .child(div().flex_1().min_w(0).truncate().text_size(13).font_family(FONT).font_bold().text_color(INK.t2).child(display(a)))
      .child(div().flex_none().text_size(11).font_family("Geist Mono").text_color(INK.t2).child("resume in pane"));
  }

  launchRow(focusRows = []) {
    const label = "Claude command";
    if (this.launchEdit) {
      return h_flex().id("acct-launch").h(32).flex_none().pl(30).pr(8).rounded(0).gap(8).items_center().bg(INK.selected)
        .child(div().flex_none().text_size(12).font_family(FONT).font_weight(600).text_color(INK.t2).child(label))
        .child(Input.new(this.launchEdit.input).h(26).flex_1().min_w(0).rounded(0).border(2)
          .border_color(INK.amberInk).bg(INK.raised).text_size(12).font_family("Geist Mono").text_color(INK.t1));
    }
    const at = focusRows.push({ run: (cx) => this.startLaunchEdit(cx) }) - 1;
    return h_flex().id("acct-launch").h(32).flex_none().pl(30).pr(8).rounded(0).gap(8).items_center().cursor_pointer()
      .when(this.focusedAt(at), (el) => el.border(2).border_color(INK.amberInk))
      .role("button").accessibility_label(`${label} ${this.launch ?? DEFAULT_LAUNCH}`)
      .hover((h) => h.bg(INK.selected))
      .tooltip("The command resumed and new Claude sessions start with")
      .on_click((_e, cx) => this.startLaunchEdit(cx))
      .child(div().flex_none().text_size(12).font_family(FONT).font_weight(600).text_color(INK.t2).child(label))
      .child(div().flex_1().min_w(0).truncate().text_size(12).font_family("Geist Mono").text_color(INK.t1)
        .child(this.launch ?? "…"))
      .child(svg("mods/arcade-accounts/pencil.svg").size(14).flex_none().text_color(INK.t2));
  }

  addAgentView() {
    const button = (id, label, primary, handle, action) => h_flex().id(id).h(30).px(12).items_center().rounded(0).border(2)
      .border_color(primary ? INK.amber : INK.buttonLine).bg(primary ? INK.amber : INK.raised)
      .text_color(primary ? INK.ink : INK.t1).text_size(12).font_family(FONT).font_weight(600).cursor_pointer()
      .when(Boolean(handle), (el) => el.track_focus(handle).tab_index(0))
      .when(Boolean(this.keyboard && handle?.is_focused?.()), (el) => el.border(2).border_color(INK.amberInk))
      .role("button").accessibility_label(label)
      .when(primary, (el) => el.hover((h) => h.bg(INK.amberHover)))
      .when(!primary, (el) => el.hover((h) => h.opacity(0.9)))
      .on_key_down((event, cx) => {
        if (event.key !== "enter" && event.key !== "space") return;
        this.keyboard = true;
        cx.stop_propagation();
        action(cx);
        cx.notify();
      })
      .on_click((_e, cx) => action(cx)).child(label);
    const label = (text) => div().text_size(11).font_family(FONT).font_weight(600).text_color(INK.t3).child(text);
    const field = (state, mono = false) => Input.new(state).h(32).px(10).rounded(0).border(2).border_color(INK.line)
      .bg(INK.raised).text_size(mono ? 12 : 13).font_family(mono ? "Geist Mono" : FONT).text_color(INK.t1);
    return v_flex().id("account-add").w_full().min_h(0).p(12).gap(8)
      .on_mouse_down("left", () => { this.keyboard = false; })
      .child(div().text_size(14).font_family(FONT).font_bold().text_color(INK.t1).child("Add custom command"))
      .child(label("Name"))
      .child(field(this.nameInput))
      .child(label("Start command"))
      .child(field(this.commandInput, true))
      .when(Boolean(this.error), (el) => el.child(div().text_size(11).font_family(FONT).text_color(INK.redInk).child(this.error)))
      .child(div().text_size(10).font_family("Geist Mono").text_color(INK.t3)
        .child("runs in your shell, so functions like claude-gpt work · ↩ add · esc cancel"))
      .child(h_flex().justify_end().gap(8)
        .child(button("acct-cancel", "Cancel", false, this.cancelHandle, () => closeOverlay(props().overlay)))
        .child(button("acct-create", this.addingModel ? "Adding…" : "Add", true, this.createHandle, () => this.addModel())));
  }

  render(cx) {
    if (this.role === "chip") return this.chip(cx);
    if (this.role === "rail") return this.rail(cx);
    if (this.role === "board") return this.board(cx);
    this.drawnFocus = this.ringKey();
    if (props()?.mode === "add") return this.addAgentView();
    return this.accountsMenu();
  }
}
