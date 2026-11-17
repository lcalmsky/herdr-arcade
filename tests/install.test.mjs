// A second install must not write through the links into the shared home. Every run is sandboxed
// in a temp folder, with herdr-shared installed into a temp home of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = join(ROOT, "tools/install.sh");
const SHARED = process.env.HERDR_SHARED || join(ROOT, "vendor", "herdr-shared");
const SKIP = existsSync(join(SHARED, "tools/install.sh"))
  ? false
  : `herdr-shared is not checked out at ${SHARED}`;

const LINKED = {
  "arcade-accounts": ["cca", "usage-tap.sh", "usage-api.mjs", "codex-usage.mjs", "models.mjs"],
  "arcade-cards": ["scan.sh"],
  "arcade-editor": ["hv", "hv-open"],
};

test("a second install writes real files instead of writing through the shared links", { skip: SKIP }, () => {
  const root = mkdtempSync(join(tmpdir(), "arcade-install-"));
  try {
    const app = join(root, "app");
    const sharedHome = join(root, "herdr-shared");
    const bin = join(root, "bin");
    mkdirSync(app, { recursive: true });
    mkdirSync(bin, { recursive: true });
    const stub = join(bin, "herdr-app");
    writeFileSync(stub, "#!/bin/sh\nexit 0\n");
    chmodSync(stub, 0o755);

    execFileSync("sh", [join(SHARED, "tools/install.sh")], {
      env: { ...process.env, HERDR_SHARED_HOME: sharedHome },
      stdio: "pipe",
    });

    const env = {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      HERDR_APP_HOME: app,
      HERDR_SHARED_HOME: sharedHome,
      HERDR_SHARED: SHARED,
    };
    const install = () => execFileSync("sh", [INSTALL], { env, stdio: "pipe" });
    const assertLinked = (when) => {
      for (const [mod, names] of Object.entries(LINKED)) {
        for (const name of names) {
          const installed = join(app, "mods", mod, name);
          assert.ok(lstatSync(installed).isSymbolicLink(), `${mod}/${name} is a link ${when}`);
          assert.equal(readlinkSync(installed), join(sharedHome, name), `${mod}/${name} points at the shared home ${when}`);
        }
      }
    };

    install();
    assertLinked("after the first install");

    // The marker stands in for the shared home drifting from this repo's vendored copy: a copy
    // that wrote through the link would replace it.
    const marker = "#!/bin/sh\n# marker: a reinstall must not write through the link\n";
    const marked = join(sharedHome, "cca");
    writeFileSync(marked, marker);

    install();
    assertLinked("after the second install");
    assert.equal(readFileSync(marked, "utf8"), marker, "the second install wrote through the link into the shared home");
    for (const names of Object.values(LINKED)) {
      for (const name of names) {
        if (name === "cca") continue;
        assert.deepEqual(readFileSync(join(sharedHome, name)), readFileSync(join(SHARED, "bin", name)),
          `the shared home's ${name} still matches herdr-shared after the second install`);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
