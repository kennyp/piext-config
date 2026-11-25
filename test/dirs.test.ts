import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { configDir, dirs, ensure, globalPath, move, stateDir, stateRoot } from "../index.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "piext-dirs-"));

test("dirs: global, local and session folders per namespace", () => {
  const home = tmp();
  const d = dirs("tasks", { home, cwd: "/p/x", sessionId: "01abc" });
  assert.equal(d.global, join(home, ".local/state/piext/tasks"));
  assert.equal(d.local, "/p/x/.pi/piext/tasks");
  assert.equal(d.session, join(home, ".local/state/piext/sessions/01abc/tasks"));
  assert.equal(dirs("tasks", { home }).local, undefined);
  assert.throws(() => dirs("../x", { home }));
  assert.throws(() => dirs("x", { home, sessionId: "../y" }));
  assert.equal(existsSync(d.global), false, "nothing is created");
  assert.equal(ensure(d.global), d.global);
  assert.ok(existsSync(d.global));
});

test("XDG_CONFIG_HOME and XDG_STATE_HOME, for the real home only", () => {
  const env = { XDG_CONFIG_HOME: "/x/cfg", XDG_STATE_HOME: "/x/state" };
  assert.equal(configDir({ env }), "/x/cfg/piext");
  assert.equal(stateRoot({ env }), "/x/state/piext");
  assert.equal(globalPath(homedir(), env), "/x/cfg/piext/config.toml");
  assert.equal(stateDir(homedir(), env), "/x/state/piext");
  assert.equal(dirs("guard", { env }).global, "/x/state/piext/guard");
  // A fake home (tests) ignores them; so does a relative path (the spec).
  assert.equal(globalPath("/fake", env), "/fake/.config/piext/config.toml");
  assert.equal(configDir({ env: { XDG_CONFIG_HOME: "rel" } }), join(homedir(), ".config/piext"));
});

test("move: once, no link left, empty old folders pruned", () => {
  const root = tmp();
  const from = join(root, "old/piext-guard/decisions.jsonl");
  const to = join(root, "new/piext/guard/decisions.jsonl");
  assert.equal(move(from, to, root), "none");
  mkdirSync(join(root, "old/piext-guard"), { recursive: true });
  writeFileSync(from, "a\n");
  assert.equal(move(from, to, root), "moved");
  assert.equal(readFileSync(to, "utf8"), "a\n");
  assert.equal(existsSync(from), false);
  assert.equal(existsSync(join(root, "old")), false, "empty parents go");
  // Both there: the new one wins, the old one is left for the caller.
  writeFileSync(join(root, "stale"), "b\n");
  assert.equal(move(join(root, "stale"), to, root), "kept");
  assert.equal(readFileSync(to, "utf8"), "a\n");
});

test("move: a folder, and parents with other files stay", () => {
  const root = tmp();
  mkdirSync(join(root, "a/b"), { recursive: true });
  writeFileSync(join(root, "a/keep"), "");
  writeFileSync(join(root, "a/b/x"), "1");
  assert.equal(move(join(root, "a/b"), join(root, "c/b"), root), "moved");
  assert.equal(readFileSync(join(root, "c/b/x"), "utf8"), "1");
  assert.ok(existsSync(join(root, "a/keep")));
});
