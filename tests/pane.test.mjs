// Source tests for the arcade-pane fork: its rounded header corners and its own icons. Run:
// node --import ./tests/stubs/register.mjs --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the arcade-pane fork squares its header's top corners and loads its own icons", () => {
  const source = readFileSync(new URL("../mods/arcade-pane/main.js", import.meta.url), "utf8");
  assert.ok(source.includes(".rounded_tl(0)"));
  assert.ok(source.includes(".rounded_tr(0)"));
  assert.ok(source.includes("mods/arcade-pane/${icon}.svg"));
  assert.equal(source.includes("mods/pane/"), false, "the fork does not load the upstream pane's icons");

  const manifest = JSON.parse(readFileSync(new URL("../mods/arcade-pane/mod.json", import.meta.url), "utf8"));
  assert.equal(manifest.title, "Arcade pane header");

  for (const name of ["LICENSE", "close.svg", "split-down.svg", "split-right.svg", "unzoom.svg", "zoom.svg"]) {
    const file = readFileSync(new URL(`../mods/arcade-pane/${name}`, import.meta.url));
    assert.ok(file.length > 0, name);
  }

  const install = readFileSync(new URL("../tools/install.sh", import.meta.url), "utf8");
  const loops = install.split("\n").filter((line) => line.startsWith("for mod in"));
  assert.equal(loops.length, 2);
  for (const line of loops) assert.ok(line.includes("arcade-pane"), line);
});
