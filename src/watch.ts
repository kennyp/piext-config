// Noticing edits to either file, by hand or through set().
import { watch as fsWatch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { globalPath, localPath } from "./config.ts";

export interface WatchOptions {
  cwd: string;
  home?: string;
  debounceMs?: number;
}

/** watch calls onChange (debounced) when either file changes; call the result to stop. */
export function watch(onChange: () => void, o: WatchOptions): () => void {
  const watchers: FSWatcher[] = [];
  let timer: NodeJS.Timeout | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, o.debounceMs ?? 100);
  };
  for (const path of [globalPath(o.home ?? homedir()), localPath(o.cwd)]) {
    // The folder, not the file: the file may not exist yet, and atomic
    // writes replace it.
    try {
      const w = fsWatch(dirname(path), (_, name) => {
        if (!name || name === basename(path)) fire();
      });
      w.on("error", () => {});
      watchers.push(w);
    } catch {
      // no such folder (yet); set() creates it, and a reload picks it up
    }
  }
  return () => {
    clearTimeout(timer);
    for (const w of watchers) w.close();
  };
}
