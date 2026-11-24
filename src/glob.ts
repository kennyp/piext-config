// Globs for names and paths: * (not across /), ** (anything), ?, and ~ for
// the home folder. Case-sensitive unless asked otherwise.
import { homedir } from "node:os";
import { join } from "node:path";

export interface GlobOptions {
  home?: string;
  /** Match regardless of case (model names, say). */
  nocase?: boolean;
}

const expand = (p: string, home: string) => (p === "~" ? home : p.startsWith("~/") ? join(home, p.slice(2)) : p);

export function globToRegExp(pattern: string, opts: GlobOptions = {}): RegExp {
  const re = expand(pattern, opts.home ?? homedir())
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\/?/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\u0000/g, ".*");
  return new RegExp(`^${re}$`, opts.nocase ? "i" : "");
}

/** glob matches pattern against all of s. */
export function glob(pattern: string, s: string, opts: GlobOptions = {}): boolean {
  return globToRegExp(pattern, opts).test(expand(s, opts.home ?? homedir()));
}

/** inDir: is dir the folder pattern names, or inside it? */
export function inDir(pattern: string, dir: string, opts: GlobOptions = {}): boolean {
  const p = pattern.replace(/\/+$/, "");
  return glob(p, dir, opts) || glob(`${p}/**`, dir, opts);
}

/** hasWildcard: does pattern use *, ** or ?. */
export const hasWildcard = (pattern: string) => /[*?]/.test(pattern);

/**
 * specificity ranks how narrow a pattern is: the count of its literal
 * characters. "anthropic/claude-opus-5-5" beats "*opus*".
 */
export const specificity = (pattern: string) => pattern.replace(/[*?]/g, "").length;
