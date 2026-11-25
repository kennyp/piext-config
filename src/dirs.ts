// Where piext files go. Settings: $XDG_CONFIG_HOME/piext (else ~/.config/piext).
// Data, by scope: global and session under $XDG_STATE_HOME/piext (else
// ~/.local/state/piext), local under the folder's .pi/piext. One folder per
// extension (its namespace) in each.
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export interface Where {
  /** Home; tests pass a fake one. A home other than the real one ignores $XDG_* (they're the real user's). */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

function xdg(name: "XDG_CONFIG_HOME" | "XDG_STATE_HOME", fallback: string[], w: Where): string {
  const home = w.home ?? homedir();
  const v = (w.env ?? process.env)[name];
  // The XDG spec: only absolute paths count.
  if (v && isAbsolute(v) && (w.home === undefined || w.home === homedir())) return v;
  return join(home, ...fallback);
}

/** $XDG_CONFIG_HOME, else ~/.config. */
export const configHome = (w: Where = {}) => xdg("XDG_CONFIG_HOME", [".config"], w);
/** $XDG_STATE_HOME, else ~/.local/state. */
export const stateHome = (w: Where = {}) => xdg("XDG_STATE_HOME", [".local", "state"], w);

/** piext's settings folder (config.toml and anything an extension keeps beside it). */
export const configDir = (w: Where = {}) => join(configHome(w), "piext");
/** piext's global state folder (trust.json, each extension's global data). */
export const stateRoot = (w: Where = {}) => join(stateHome(w), "piext");

export interface DirsOptions extends Where {
  /** The folder for local data (the session's cwd). */
  cwd?: string;
  /** The pi session (ctx.sessionManager.getSessionId()), for session data. */
  sessionId?: string;
}

export interface Dirs {
  /** Data for every session: <state>/piext/<ns>. */
  global: string;
  /** Data for this folder: <cwd>/.pi/piext/<ns> (with cwd). */
  local?: string;
  /** Data for one pi session, kept when it's resumed: <state>/piext/sessions/<id>/<ns> (with sessionId). */
  session?: string;
}

const NS = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * dirs: where extension ns keeps its data at each scope. Nothing is created;
 * use ensure() on the one you write to.
 */
export function dirs(ns: string, o: DirsOptions = {}): Dirs {
  if (!NS.test(ns)) throw new Error(`piext-config: bad namespace ${JSON.stringify(ns)}`);
  const out: Dirs = { global: join(stateRoot(o), ns) };
  if (o.cwd) out.local = join(resolve(o.cwd), ".pi", "piext", ns);
  if (o.sessionId) {
    if (!NS.test(o.sessionId)) throw new Error(`piext-config: bad session id ${JSON.stringify(o.sessionId)}`);
    out.session = join(stateRoot(o), "sessions", o.sessionId, ns);
  }
  return out;
}

/** ensure creates dir (and its parents) and returns it. */
export function ensure(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export type Moved = "moved" | "none" | "kept";

/**
 * move puts a file or folder from an old location at its new one, once:
 * "moved" when it did, "none" when there was nothing at from, "kept" when
 * to already exists (from is left alone: the caller decides, usually by
 * reading only to). No link is left behind. Then the old parent folders,
 * up to (not including) stop, go if they're empty.
 */
export function move(from: string, to: string, stop?: string): Moved {
  if (!existsSync(from)) return "none";
  if (existsSync(to)) return "kept";
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EXDEV") throw e;
    cpSync(from, to, { recursive: true, preserveTimestamps: true, errorOnExist: true });
    rmSync(from, { recursive: true });
  }
  if (stop) pruneEmpty(dirname(from), stop);
  return "moved";
}

/** pruneEmpty removes dir and its empty parents, stopping at stop. */
export function pruneEmpty(dir: string, stop: string): void {
  stop = resolve(stop);
  for (let d = resolve(dir); d !== stop && d.startsWith(stop + "/"); d = dirname(d)) {
    try {
      if (readdirSync(d).length > 0) return;
      rmdirSync(d);
    } catch {
      return;
    }
  }
}
