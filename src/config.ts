// Reading the layers: ~/.config/piext/config.toml (global), then
// <dir>/.pi/piext.toml (local), then the session's own overrides. Each
// extension reads its own table, [<ns>], from each, and merges them.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { inDir } from "./glob.ts";

export type Scope = "global" | "local" | "session";
export type Table = Record<string, unknown>;

export const globalPath = (home = homedir()) => join(home, ".config", "piext", "config.toml");
export const localPath = (cwd: string) => join(cwd, ".pi", "piext.toml");
export const stateDir = (home = homedir()) => join(home, ".local", "state", "piext");
const trustPath = (home: string) => join(stateDir(home), "trust.json");

/** The key a global table uses to apply only in some folders. */
export const DIRS_KEY = "dirs";

export interface Layer {
  scope: Scope;
  /** The file it came from (not for the session layer). */
  path?: string;
  /** The namespace's table; undefined when the layer doesn't have one. */
  table?: Table;
  /** A global table whose `dirs` don't include cwd: it doesn't apply here. */
  skipped?: boolean;
  /** Global and session tables always are; a local one once you trust it. */
  trusted: boolean;
  /** The table's hash, for trusting a local one. */
  hash?: string;
  /** The file couldn't be read as TOML. */
  error?: string;
}

export interface ReadOptions {
  cwd: string;
  home?: string;
  /** The session's entries (ctx.sessionManager.getBranch()), for its layer. */
  entries?: readonly unknown[];
}

/** File contents by path; a missing file is undefined. */
function readText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

const parsed = new Map<string, { text: string; doc?: Table; error?: string }>();

/** parseFile reads and parses path (cached by contents). */
export function parseFile(path: string): { doc?: Table; error?: string } {
  const text = readText(path);
  if (text === undefined) return {};
  const hit = parsed.get(path);
  if (hit && hit.text === text) return hit;
  let out: { text: string; doc?: Table; error?: string };
  try {
    out = { text, doc: parseToml(text) as Table };
  } catch (e) {
    out = { text, error: (e as Error).message.split("\n")[0] };
  }
  parsed.set(path, out);
  return out;
}

const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Stable JSON (sorted keys), for hashing a table. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (isTable(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v instanceof Date ? v.toISOString() : v);
}

export const hashTable = (t: Table) => createHash("sha256").update(canonical(t)).digest("hex").slice(0, 16);

function readTrust(home: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(trustPath(home), "utf8"));
  } catch {
    return {};
  }
}

const trustKey = (path: string, ns: string) => `${path}#${ns}`;

/**
 * trust remembers the local [ns] table, as it is now, as trusted. Editing
 * it (and only it: other tables in the file don't count) needs trust again.
 * Returns the hash, or undefined when there's no such table.
 */
export function trust(ns: string, cwd: string, home = homedir()): string | undefined {
  const path = localPath(cwd);
  const t = parseFile(path).doc?.[ns];
  if (!isTable(t)) return undefined;
  const all = readTrust(home);
  all[trustKey(path, ns)] = hashTable(t);
  writeAtomic(trustPath(home), JSON.stringify(all, null, 2) + "\n");
  return all[trustKey(path, ns)];
}

/** sessionTable: the namespace's session overrides, if any. */
export function sessionTable(ns: string, entries: readonly unknown[] = []): Table | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as { type?: string; customType?: string; data?: { ns?: string; table?: unknown } };
    if (e?.type === "custom" && e.customType === SESSION_ENTRY && e.data?.ns === ns) return isTable(e.data.table) ? e.data.table : undefined;
  }
  return undefined;
}

/** The custom entry type session overrides are saved under. */
export const SESSION_ENTRY = "piext-config";

/** readLayers: the namespace's table at each level, lowest first. */
export function readLayers(ns: string, o: ReadOptions): Layer[] {
  const home = o.home ?? homedir();
  const layers: Layer[] = [];
  const trusted = readTrust(home);
  for (const [scope, path] of [["global", globalPath(home)], ["local", localPath(o.cwd)]] as const) {
    const { doc, error } = parseFile(path);
    const layer: Layer = { scope, path, trusted: scope === "global", error };
    const t = doc?.[ns];
    if (t !== undefined && !isTable(t)) layer.error = `[${ns}] should be a table`;
    else if (t) {
      layer.table = t;
      layer.hash = hashTable(t);
      if (scope === "local") layer.trusted = trusted[trustKey(path, ns)] === layer.hash;
      const dirs = t[DIRS_KEY];
      if (scope === "global" && dirs !== undefined) {
        const list = Array.isArray(dirs) ? dirs.map(String) : [String(dirs)];
        layer.skipped = !list.some((d) => inDir(d, o.cwd, { home }));
      }
    }
    layers.push(layer);
  }
  const s = sessionTable(ns, o.entries);
  layers.push({ scope: "session", table: s, trusted: true, hash: s && hashTable(s) });
  return layers;
}

/** Where each setting came from: a dotted key ("models.opus.threshold") to its level. */
export type Sources = Record<string, Scope | "default">;

export interface LoadOptions<T> extends ReadOptions {
  defaults: T;
  /**
   * apply merges one layer's table into what's there so far. The default
   * deep-merges tables (arrays and values replace). piext-guard's, say,
   * only lets an untrusted local table make things stricter.
   */
  apply?: (acc: T, table: Table, layer: Layer) => T;
  /** Untrusted local tables: applied (default) or left out. */
  untrusted?: "apply" | "skip";
  /** validate checks (and may fix up) the result; throw to report a problem. */
  validate?: (value: T) => T;
}

export interface Loaded<T> {
  value: T;
  layers: Layer[];
  sources: Sources;
  /** Problems: unparseable files, validation. The value still has the defaults where it must. */
  errors: string[];
}

/** load reads the namespace's settings from every level. */
export function load<T extends object>(ns: string, o: LoadOptions<T>): Loaded<T> {
  const layers = readLayers(ns, o);
  const errors: string[] = [];
  const sources: Sources = {};
  for (const k of leafKeys(o.defaults as Table)) sources[k] = "default";
  let value = structuredClone(o.defaults);
  for (const layer of layers) {
    if (layer.error) errors.push(`${layer.path ?? layer.scope}: ${layer.error}`);
    if (!layer.table || layer.skipped) continue;
    if (!layer.trusted && o.untrusted === "skip") continue;
    const table = stripReserved(layer);
    try {
      value = o.apply ? o.apply(value, table, layer) : (deepMerge(value as Table, table) as T);
      for (const k of leafKeys(table)) sources[k] = layer.scope;
    } catch (e) {
      errors.push(`${layer.path ?? layer.scope}: ${(e as Error).message}`);
    }
  }
  if (o.validate) {
    try {
      value = o.validate(value);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { value, layers, sources, errors };
}

function stripReserved(layer: Layer): Table {
  if (layer.scope !== "global" || !(DIRS_KEY in layer.table!)) return layer.table!;
  const { [DIRS_KEY]: _, ...rest } = layer.table!;
  return rest;
}

/** deepMerge merges b into a copy of a: tables merge, everything else replaces. */
export function deepMerge(a: Table, b: Table): Table {
  const out: Table = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isTable(v) && isTable(out[k]) ? deepMerge(out[k] as Table, v) : structuredClone(v);
  return out;
}

/** leafKeys lists a table's dotted keys down to its values (arrays are values). */
export function leafKeys(t: Table, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isTable(v) && Object.keys(v).length) out.push(...leafKeys(v, key));
    else out.push(key);
  }
  return out;
}

export function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
