// Rail tests for the arcade-rail mod: the repository grouping the HIGH SCORE board draws from and
// the git read that starts as soon as a terminal folder is known. Run:
// node --import ./tests/stubs/register.mjs --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import ArcadeRail, { railTree } from "../mods/arcade-rail/main.js";

const space = (id, name) => ({
  id, name, active: false, folder: "", machine: null, named: true, index: 0, status: null,
  tabs: [{ id: `tb-${id}`, name: "", active: false, focused: null, before: [], zoomed: null, settled: null }],
});

const row = (id, name, repo) => ({ space: space(id, name), mine: [], repo });

test("the spaces of one repository share a head and rank from one inside it", () => {
  const api = { common: "/work/api/.git", base: true };
  const web = { common: "/work/web/.git", base: false };
  const rows = [
    row("a1", "space one", api),
    row("w1", "space two", web),
    row("a2", "space three", api),
    row("a3", "space four", api),
    row("w2", "space five", web),
  ];
  const groups = railTree(rows, []);
  assert.deepEqual(groups.map((group) => group.head), ["api", "web"], "one group per repository, named by it");
  assert.deepEqual(groups.map((group) => group.rows.length), [3, 2], "each repository keeps its own rows");
});

test("a terminal folder the rail has not asked git about is read on the next render", async () => {
  const pending = [];
  const cx = {
    notifies: 0,
    every: [],
    timer: { every(ms, fn) { cx.every.push({ ms, fn }); return { cancel() {} }; }, after() { return { cancel() {} }; } },
    spawn(fn) { const task = Promise.resolve().then(() => fn(cx)); pending.push(task); return task; },
    notify() { cx.notifies += 1; },
    stop_propagation() {},
    focus_handle() { return { focus() {}, is_focused: () => false, release() { return true; } }; },
  };
  const flush = () => Promise.all(pending);
  const view = new ArcadeRail();
  globalThis.herdrExec = [];
  globalThis.herdrState = { terminals: [], agents: [], panes: [], spaces: [space("s1", "one")] };
  try {
    view.init({}, cx);
    await flush();
    view.render(cx);
    assert.deepEqual(globalThis.herdrExec, [], "nothing to read while no terminal is known");
    globalThis.herdrState.terminals = [{ address: "t1", cwd: "/work/api/one" }];
    view.render(cx);
    await flush();
    assert.equal(globalThis.herdrExec.length, 1, "the new folder is read at once");
    assert.deepEqual(globalThis.herdrExec[0], ["git", ["-C", "/work/api/one", "rev-parse", "--path-format=absolute",
      "--git-common-dir", "--show-toplevel"]], "the read asks git for the repository's common dir");
    assert.equal("/work/api/one" in view.repos, true, "the answer is cached under the folder");
  } finally {
    globalThis.herdrExec = undefined;
    globalThis.herdrState = undefined;
  }
});

test("the repositories git named last time are there at launch, before any read finishes", () => {
  const cx = {
    timer: { every() { return { cancel() {} }; }, after() { return { cancel() {} }; } },
    spawn() { return new Promise(() => {}); },
    notify() {},
    focus_handle() { return { focus() {}, is_focused: () => false, release() { return true; } }; },
  };
  const saved = { "/work/api/one": { common: "/work/api/.git", base: true } };
  localStorage.setItem("arcade-rail.repos", JSON.stringify(saved));
  globalThis.herdrState = { terminals: [], agents: [], panes: [], spaces: [] };
  try {
    const view = new ArcadeRail();
    view.init({}, cx);
    assert.deepEqual(view.repos, saved);
  } finally {
    localStorage.setItem("arcade-rail.repos", "{}");
    globalThis.herdrState = undefined;
  }
});
