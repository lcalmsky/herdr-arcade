// The arcade palette is design/tokens.css and design/arcade.css; every colour literal in
// mods/*/*.js must be one of those tokens, and every size, weight, spacing and radius literal a
// step from the lists below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";

const DESIGN = new URL("../design/", import.meta.url);
const MODS = new URL("../mods/", import.meta.url);
const css = readFileSync(new URL("tokens.css", DESIGN), "utf8")
  + readFileSync(new URL("arcade.css", DESIGN), "utf8");

const SIZE_STEPS = [9, 10, 11, 12, 13, 14, 16, 18];
const WEIGHTS = [400, 600, 700, 800];
const SPACING = [2, 4, 6, 8, 10, 12, 16, 20, 24];
const RADIUS = [0, 6, 8, 10, 12, 16];

function oklchToHex(lightness, chroma, hue) {
  const h = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(h);
  const b = chroma * Math.sin(h);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channels = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${channels.map((value) => {
    const x = Math.max(0, Math.min(1, value));
    const encoded = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
    return Math.round(encoded * 255).toString(16).padStart(2, "0");
  }).join("")}`;
}

const cssHex = [...css.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
const cssOklch = [...css.matchAll(/oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*\)/g)]
  .map((m) => oklchToHex(Number(m[1]) / 100, Number(m[2]), Number(m[3])));
const allowed = new Set([...cssHex, ...cssOklch]);

const TOKEN = {
  paper: oklchToHex(0.21, 0.07, 290), paper2: oklchToHex(0.26, 0.08, 290),
  paper3: oklchToHex(0.31, 0.09, 290), ink1: oklchToHex(0.96, 0.02, 290),
  ink2: oklchToHex(0.86, 0.04, 290), muted: oklchToHex(0.74, 0.05, 290),
  rule: oklchToHex(0.40, 0.09, 290), accent: oklchToHex(0.70, 0.25, 350),
  accentInk: oklchToHex(0.18, 0.05, 350), accentSoft: oklchToHex(0.34, 0.14, 350),
  play: oklchToHex(0.82, 0.13, 210), playSoft: oklchToHex(0.30, 0.08, 220),
  score: oklchToHex(0.88, 0.16, 95), term: oklchToHex(0.17, 0.055, 290),
};

function jsFiles() {
  const out = [];
  for (const dir of readdirSync(MODS)) {
    const folder = new URL(`${dir}/`, MODS);
    let names;
    try { names = readdirSync(folder); } catch { continue; }
    for (const name of names) {
      const file = new URL(name, folder);
      if (name.endsWith(".js") && !name.endsWith(".d.ts") && statSync(file).isFile()) out.push(file);
    }
  }
  return out.sort((a, b) => a.pathname.localeCompare(b.pathname));
}

const files = jsFiles().map((url) => ({ name: url.pathname.slice(MODS.pathname.length), text: readFileSync(url, "utf8") }));
const lineOf = (text, index) => text.slice(0, index).split("\n").length;

test("every colour, text size, weight, spacing and radius literal comes from the design tokens", () => {
  assert.ok(allowed.size > 15, "the design tokens were read");
  assert.ok(allowed.has(TOKEN.accent) && allowed.has(TOKEN.play) && allowed.has(TOKEN.score));

  const failures = [];
  const fail = (file, text, index, value, rule) => failures.push(`${file}:${lineOf(text, index)} ${value} ${rule}`);

  for (const { name, text } of files) {
    for (const m of text.matchAll(/#[0-9a-fA-F]{6,8}(?![0-9a-fA-F])/g)) {
      const value = m[0].toLowerCase();
      const ok = (value.length === 7 && allowed.has(value))
        || (value.length === 9 && (value === "#00000000" || allowed.has(value.slice(0, 7))));
      if (!ok) fail(name, text, m.index, value, "is not a design token or a token's alpha variant");
    }

    for (const m of text.matchAll(/text_size\((\d+(?:\.\d+)?)\)/g)) {
      if (!SIZE_STEPS.includes(Number(m[1]))) fail(name, text, m.index, `text_size(${m[1]})`, "is not a text-size step");
    }

    for (const m of text.matchAll(/font_weight\((\d+)\)/g)) {
      if (!WEIGHTS.includes(Number(m[1]))) fail(name, text, m.index, `font_weight(${m[1]})`, "is not an allowed weight");
    }

    for (const m of text.matchAll(/\.(gap|px|py|pt|pb|pl|pr|mx|my|mt|mb|ml|mr|m|p)\((-?\d+(?:\.\d+)?)\)/g)) {
      const value = Number(m[2]);
      // A larger value is an alignment indent; a negative one an offset.
      if (value < 0 || value > Math.max(...SPACING) || SPACING.includes(value)) continue;
      fail(name, text, m.index, m[0], "is not a spacing step");
    }

    for (const m of text.matchAll(/\.(rounded|rounded_[a-z]+)\((-?\d+(?:\.\d+)?)\)/g)) {
      const value = Number(m[2]);
      if (RADIUS.includes(value)) continue;
      // A radius at or past half the element's height or size is the spec's pill/circle case.
      const start = text.lastIndexOf(";", m.index) + 1;
      const end = text.indexOf(";", m.index + m[0].length);
      const statement = text.slice(start, end < 0 ? undefined : end);
      const halves = [...statement.matchAll(/\.(?:h|size)\((\d+(?:\.\d+)?)\)/g)].map((h) => Number(h[1]) / 2);
      if (halves.some((half) => value >= half)) continue;
      fail(name, text, m.index, m[0], "is not a radius step");
    }

    if (name === "arcade-cards/main.js") {
      const from = text.indexOf("TEXT: {");
      const block = text.slice(from, text.indexOf("},", from));
      for (const m of block.matchAll(/s\((\d+(?:\.\d+)?)\)/g)) {
        if (!SIZE_STEPS.includes(Number(m[1]))) fail(name, text, from + m.index, `s(${m[1]})`, "in TEXT is not a text-size step");
      }
    }
  }

  assert.deepEqual(failures, [], "literals outside the design tokens");
});

function luminance(hex) {
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test("the ink and status pairs meet 4.5 : 1 on the dark arcade ground", () => {
  const pairs = [];
  for (const ink of ["ink1", "ink2", "muted"]) {
    for (const surface of ["paper", "paper2", "paper3"]) pairs.push([ink, surface]);
  }
  pairs.push(["accentInk", "accent"], ["accent", "paper2"], ["play", "paper2"], ["score", "paper2"]);

  const failures = pairs
    .filter(([a, b]) => contrast(TOKEN[a], TOKEN[b]) < 4.5)
    .map(([a, b]) => `${a} on ${b} is ${contrast(TOKEN[a], TOKEN[b]).toFixed(2)}`);
  assert.deepEqual(failures, [], "contrast below 4.5 : 1");
});
