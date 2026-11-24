// One-off: move the old per-extension config files into the shared ones.
//
//   node scripts/migrate.ts [--apply] [root…]
//
// Old global files (~/.config/piext-{guard,nudge,tasks}/config.toml) go to
// ~/.config/piext/config.toml; old local files (.pi/{guard,nudge,tasks}.toml
// under each root, default ~/Projects) go to that folder's .pi/piext.toml.
// Comments stay: each file's tables are prefixed with its namespace. Without
// --apply it only prints what it would write. With it, the old files become
// *.bak (--keep: they stay). Files git tracks are skipped.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "smol-toml";
import { globalPath, localPath, writeAtomic } from "../src/config.ts";

const NS = ["guard", "nudge", "tasks"];
const args = process.argv.slice(2);
const apply = args.includes("--apply");
// --keep: leave the old files in place (remove them yourself once all's well).
const keep = args.includes("--keep");
// Files a repo tracks are left alone: changing them is a change to the repo.
const tracked = (path: string) => {
  try {
    execFileSync("git", ["-C", dirname(path), "ls-files", "--error-unmatch", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) roots.push(join(homedir(), "Projects"));

/** nest rewrites a flat file as the [ns] table of a shared one. */
export function nest(ns: string, text: string): string {
  const lines = text.replace(/\n$/, "").split("\n");
  // [ns] goes before the first key (or table), after a leading comment block.
  let at = lines.findIndex((l) => /^\s*[^#\s]/.test(l));
  if (at < 0) at = lines.length;
  const out = lines.map((l) => l.replace(/^(\s*)(\[\[?)\s*/, `$1$2${ns}.`));
  if (at < lines.length && !/^\s*\[/.test(lines[at])) out.splice(at, 0, `[${ns}]`);
  return out.join("\n") + "\n";
}

type Move = { from: string; to: string; ns: string };
const moves: Move[] = [];
for (const ns of NS) {
  const from = join(homedir(), ".config", `piext-${ns}`, "config.toml");
  if (existsSync(from)) moves.push({ from, to: globalPath(), ns });
}
for (const root of roots) {
  const found = execFileSync("find", [root, "-maxdepth", "6", "-path", "*/node_modules", "-prune", "-o", "-path", "*/.pi/*.toml", "-print"], { encoding: "utf8" });
  for (const from of found.split("\n").filter(Boolean)) {
    const ns = /\/\.pi\/(\w+)\.toml$/.exec(from)?.[1];
    if (ns && NS.includes(ns) && tracked(from)) console.error(`skip ${from}: tracked by git`);
    else if (ns && NS.includes(ns)) moves.push({ from, to: localPath(dirname(dirname(from))), ns });
  }
}

const targets = new Map<string, { text: string; moves: Move[] }>();
for (const m of moves) {
  const t = targets.get(m.to) ?? { text: existsSync(m.to) ? readFileSync(m.to, "utf8") : "", moves: [] };
  const doc = parse(t.text) as Record<string, unknown>;
  if (m.ns in doc) {
    console.error(`skip ${m.from}: ${m.to} already has [${m.ns}]`);
    continue;
  }
  const old = readFileSync(m.from, "utf8");
  const nested = nest(m.ns, old);
  const next = (t.text && !t.text.endsWith("\n\n") ? t.text.replace(/\n*$/, "\n\n") : t.text) + nested;
  // The table must come through unchanged.
  const want = JSON.stringify(parse(old)), got = JSON.stringify((parse(next) as Record<string, unknown>)[m.ns] ?? {});
  if (want !== got) throw new Error(`${m.from}: [${m.ns}] came out different:\n${want}\n${got}`);
  t.text = next;
  t.moves.push(m);
  targets.set(m.to, t);
}

for (const [to, t] of targets) {
  console.log(`\n=== ${to}  ← ${t.moves.map((m) => m.from).join(", ")}\n${t.text}`);
  if (!apply) continue;
  writeAtomic(to, t.text);
  if (!keep) for (const m of t.moves) renameSync(m.from, `${m.from}.bak`);
}
console.log(apply ? `\nWritten${keep ? "; old files kept" : "; old files renamed to *.bak"}.` : "\nDry run. --apply to write.");
