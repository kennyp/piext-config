import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editText, glob, globalPath, inDir, load, localPath, parseKeyPath, set, setSession, specificity, trust, watch, SESSION_ENTRY } from "../index.ts";

function setup(global?: string, local?: string) {
  const root = mkdtempSync(join(tmpdir(), "piext-config-"));
  const home = join(root, "home"), cwd = join(root, "proj");
  mkdirSync(cwd, { recursive: true });
  if (global !== undefined) {
    mkdirSync(join(home, ".config", "piext"), { recursive: true });
    writeFileSync(globalPath(home), global);
  }
  if (local !== undefined) {
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(localPath(cwd), local);
  }
  return { home, cwd };
}

const defaults = { enabled: true, threshold: 0.75, models: {} as Record<string, unknown> };

test("layers merge in order and record where each value came from", () => {
  const { home, cwd } = setup(
    `[handoff]\nthreshold = 0.6\n[handoff.models.opus]\nname = "*opus*"\nthreshold = 0.5\n[other]\nx = 1\n`,
    `[handoff]\nenabled = false\n[handoff.models.opus]\nthreshold = 0.4\n`,
  );
  const entries = [{ type: "custom", customType: SESSION_ENTRY, data: { ns: "handoff", table: { threshold: 0.9 } } }];
  const r = load("handoff", { cwd, home, defaults, entries });
  assert.deepEqual(r.value, { enabled: false, threshold: 0.9, models: { opus: { name: "*opus*", threshold: 0.4 } } });
  assert.equal(r.sources.enabled, "local");
  assert.equal(r.sources.threshold, "session");
  assert.equal(r.sources["models.opus.name"], "global");
  assert.equal(r.sources["models.opus.threshold"], "local");
  assert.deepEqual(r.errors, []);
});

test("defaults alone, and the defaults aren't changed", () => {
  const { home, cwd } = setup();
  const r = load("handoff", { cwd, home, defaults });
  assert.deepEqual(r.value, defaults);
  assert.notEqual(r.value, defaults);
  assert.equal(r.sources.threshold, "default");
});

test("global dirs limit a table to some folders", () => {
  const { home, cwd } = setup(`[handoff]\ndirs = ["/nowhere/**"]\nthreshold = 0.1\n`);
  assert.equal(load("handoff", { cwd, home, defaults }).value.threshold, 0.75);
  const { home: h2, cwd: c2 } = setup(`[handoff]\nthreshold = 0.1\n`);
  writeFileSync(globalPath(h2), `[handoff]\ndirs = ["${c2}"]\nthreshold = 0.1\n`);
  const r = load("handoff", { cwd: c2, home: h2, defaults });
  assert.equal(r.value.threshold, 0.1);
  assert.equal("dirs" in r.value, false);
});

test("a broken file is reported, the others still apply", () => {
  const { home, cwd } = setup(`[handoff]\nthreshold = 0.6\n`, `[handoff\n`);
  const r = load("handoff", { cwd, home, defaults });
  assert.equal(r.value.threshold, 0.6);
  assert.equal(r.errors.length, 1);
});

test("trust is per table and per contents", () => {
  const { home, cwd } = setup(undefined, `[handoff]\nthreshold = 0.1\n[nudge]\ndelay = "1m"\n`);
  const r1 = load("handoff", { cwd, home, defaults, untrusted: "skip" });
  assert.equal(r1.value.threshold, 0.75);
  assert.equal(r1.layers[1].trusted, false);
  trust("handoff", cwd, home);
  assert.equal(load("handoff", { cwd, home, defaults, untrusted: "skip" }).value.threshold, 0.1);
  // Editing another table keeps this one trusted; editing it doesn't.
  writeFileSync(localPath(cwd), `[handoff]\nthreshold = 0.1\n[nudge]\ndelay = "2m"\n`);
  assert.equal(load("handoff", { cwd, home, defaults, untrusted: "skip" }).layers[1].trusted, true);
  writeFileSync(localPath(cwd), `[handoff]\nthreshold = 0.2\n`);
  assert.equal(load("handoff", { cwd, home, defaults, untrusted: "skip" }).layers[1].trusted, false);
});

test("a custom apply sees each layer", () => {
  const { home, cwd } = setup(`[g]\nmode = "warn"\n`, `[g]\nmode = "off"\n`);
  const order = { off: 0, warn: 1, enforce: 2 } as const;
  const r = load("g", {
    cwd, home, defaults: { mode: "enforce" as keyof typeof order },
    apply: (acc, t, layer) => {
      const m = t.mode as keyof typeof order;
      return layer.trusted || order[m] > order[acc.mode] ? { mode: m } : acc;
    },
  });
  assert.equal(r.value.mode, "warn");
});

test("validate reports problems", () => {
  const { home, cwd } = setup(`[handoff]\nthreshold = 2\n`);
  const r = load("handoff", { cwd, home, defaults, validate: (v) => { if (v.threshold > 1) throw new Error("threshold should be 0–1"); return v; } });
  assert.deepEqual(r.errors, ["threshold should be 0–1"]);
});

test("editText keeps comments and layout", () => {
  const text = `# top\n[handoff] # mine\nthreshold = 0.75 # the usual\n\n# models\n[handoff.models.opus]\nname = "*opus*"\n\n[nudge]\ndelay = "2m"\n`;
  const out = editText(text, "handoff", { threshold: 0.5, turns: 20, models: { opus: { threshold: 0.4 }, "claude-4.5": { name: "a/claude-4.5" } } });
  assert.equal(
    out,
    `# top\n[handoff] # mine\nthreshold = 0.5  # the usual\nturns = 20\n\n# models\n[handoff.models.opus]\nname = "*opus*"\nthreshold = 0.4\n\n[nudge]\ndelay = "2m"\n\n[handoff.models."claude-4.5"]\nname = "a/claude-4.5"\n`,
  );
  assert.equal(editText(out, "handoff", { turns: null }).includes("turns"), false);
  assert.equal(editText("", "x", { a: [1, 2], b: "q#" }), `[x]\na = [ 1, 2 ]\nb = "q#"\n`);
  assert.throws(() => editText(`[[x]]\na = 1\n`, "x", { a: 2 }));
});

test("set writes the right file", () => {
  const { home, cwd } = setup();
  set("handoff", "local", { enabled: false }, { cwd, home });
  set("handoff", "global", { threshold: 0.6 }, { cwd, home });
  assert.equal(readFileSync(localPath(cwd), "utf8"), `[handoff]\nenabled = false\n`);
  assert.equal(load("handoff", { cwd, home, defaults }).value.threshold, 0.6);
});

test("session overrides merge, and null removes", () => {
  const entries: any[] = [];
  const pi = { appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }) };
  setSession(pi, "handoff", entries, { threshold: 0.5, models: { a: { turns: 3 } } });
  setSession(pi, "handoff", entries, { enabled: false, models: { a: { turns: null } } });
  assert.deepEqual(entries.at(-1).data, { ns: "handoff", table: { threshold: 0.5, enabled: false } });
});

test("keys and globs", () => {
  assert.deepEqual(parseKeyPath(`handoff.models."claude-4.5".x`), ["handoff", "models", "claude-4.5", "x"]);
  assert.equal(glob("*opus-5-5", "anthropic/claude-opus-5-5", { nocase: true }), false); // * stops at /
  assert.equal(glob("**opus-5-5", "anthropic/claude-OPUS-5-5", { nocase: true }), true);
  assert.equal(inDir("~/Projects", "/h/Projects/a/b", { home: "/h" }), true);
  assert.equal(inDir("~/Projects", "/h/Other", { home: "/h" }), false);
  assert.ok(specificity("anthropic/claude-opus-5-5") > specificity("*opus*"));
});

test("watch sees a change", async () => {
  const { home, cwd } = setup(undefined, `[a]\n`);
  let n = 0;
  const stop = watch(() => n++, { cwd, home, debounceMs: 20 });
  await new Promise((r) => setTimeout(r, 50));
  set("a", "local", { x: 1 }, { cwd, home });
  await new Promise((r) => setTimeout(r, 300));
  stop();
  assert.ok(n >= 1);
});
