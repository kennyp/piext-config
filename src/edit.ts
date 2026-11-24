// Changing a config file without losing its comments or layout: values are
// replaced on their own lines, new keys go at the end of their table, new
// tables at the end of the file. The result is parsed before it's written,
// so a change never leaves a file pi can't read.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { parse as parseToml, stringify } from "smol-toml";
import { globalPath, localPath, writeAtomic, type Table } from "./config.ts";

/** A change: nested tables of new values; null removes a key. */
export type Patch = { [key: string]: unknown };

const BARE = /^[A-Za-z0-9_-]+$/;
export const quoteKey = (k: string) => (BARE.test(k) ? k : JSON.stringify(k));
export const keyPath = (segs: string[]) => segs.map(quoteKey).join(".");

/** parseKeyPath splits a TOML key ("a.\"b.c\".d") into its parts. */
export function parseKeyPath(s: string): string[] {
  const out: string[] = [];
  let i = 0;
  const ws = () => {
    while (s[i] === " " || s[i] === "\t") i++;
  };
  while (i < s.length) {
    ws();
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i];
      let j = i + 1, part = "";
      while (j < s.length && s[j] !== q) {
        if (q === '"' && s[j] === "\\") {
          part += JSON.parse(`"${s.slice(j, j + 2)}"`);
          j += 2;
          continue;
        }
        part += s[j++];
      }
      out.push(part);
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== "." && s[j] !== " " && s[j] !== "\t") j++;
      out.push(s.slice(i, j));
      i = j;
    }
    ws();
    if (s[i] === ".") i++;
    else if (i < s.length) throw new Error(`bad key: ${s}`);
  }
  return out;
}

const isTable = (v: unknown): v is Table => typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Flatten a patch into (table path, key, value) leaves. */
function leaves(p: Patch, table: string[], out: { table: string[]; key: string; value: unknown }[] = []) {
  for (const [k, v] of Object.entries(p)) {
    if (isTable(v)) leaves(v, [...table, k], out);
    else out.push({ table, key: k, value: v });
  }
  return out;
}

const valueText = (v: unknown) => {
  if (Array.isArray(v) && v.some(isTable)) throw new Error("arrays of tables can't be set; edit the file");
  return stringify({ v }).replace(/^v = /, "").trimEnd();
};

interface Section {
  path: string[];
  header: number; // line index; -1 for the top of the file
  end: number; // index after its last line
  array: boolean;
}

const HEADER = /^\s*(\[\[?)\s*(.+?)\s*\]\]?\s*(#.*)?$/;

function sections(lines: string[]): Section[] {
  const out: Section[] = [{ path: [], header: -1, end: lines.length, array: false }];
  lines.forEach((line, i) => {
    const m = HEADER.exec(line);
    if (!m) return;
    out[out.length - 1].end = i;
    out.push({ path: parseKeyPath(m[2]), header: i, end: lines.length, array: m[1] === "[[" });
  });
  return out;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The line setting key in a section (plain `key = …` lines only). */
function findKey(lines: string[], s: Section, key: string): number {
  for (let i = s.header + 1; i < s.end; i++) {
    const m = /^\s*((?:"[^"]*"|'[^']*'|[A-Za-z0-9_-]+))\s*=/.exec(lines[i]);
    if (m && parseKeyPath(m[1])[0] === key) return i;
  }
  return -1;
}

/** A value's own trailing comment, kept when the value changes. */
function trailingComment(line: string): string {
  // Strings may hold #; find a # outside quotes.
  let q: string | undefined;
  for (let i = line.indexOf("=") + 1; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = undefined;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#") return "  " + line.slice(i).trimStart();
  }
  return "";
}

/** editText applies a patch to [ns] in a file's text. */
export function editText(text: string, ns: string, patch: Patch): string {
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  for (const { table, key, value } of leaves(patch, [ns])) {
    const all = sections(lines);
    const s = all.find((x) => same(x.path, table) && !x.array);
    if (all.some((x) => x.array && same(x.path, table))) throw new Error(`[[${keyPath(table)}]] is an array of tables; edit the file`);
    if (!s) {
      if (value === null || value === undefined) continue;
      if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
      lines.push(`[${keyPath(table)}]`, `${quoteKey(key)} = ${valueText(value)}`);
      continue;
    }
    const at = findKey(lines, s, key);
    if (value === null || value === undefined) {
      if (at >= 0) lines.splice(at, 1);
      continue;
    }
    const line = `${quoteKey(key)} = ${valueText(value)}`;
    if (at >= 0) {
      const indent = /^\s*/.exec(lines[at])![0];
      lines[at] = indent + line + trailingComment(lines[at]);
      continue;
    }
    // After the table's last value: blank lines and comments before the
    // next table belong to it.
    let ins = s.end;
    while (ins - 1 > s.header && /^\s*(#.*)?$/.test(lines[ins - 1])) ins--;
    lines.splice(ins, 0, line);
  }
  const out = lines.join("\n") + "\n";
  parseToml(out); // throws rather than write something unreadable
  return out;
}

export interface SetOptions {
  cwd: string;
  home?: string;
}

/**
 * set changes [ns] in the global or local file, creating it if needed, and
 * returns the path it wrote.
 */
export function set(ns: string, scope: "global" | "local", patch: Patch, o: SetOptions): string {
  const path = scope === "global" ? globalPath(o.home ?? homedir()) : localPath(o.cwd);
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    // a new file
  }
  writeAtomic(path, editText(text, ns, patch));
  return path;
}
