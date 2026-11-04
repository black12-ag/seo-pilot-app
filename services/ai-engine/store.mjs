import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { log } from "./log.mjs";

const DEFAULT_STATE = { engine: "api", model: null };

/** The chosen engine and model, kept in a small file so restarts keep them. */
export function createStore(file) {
  return {
    async read() {
      try {
        const parsed = JSON.parse(await readFile(file, "utf8"));
        if (typeof parsed?.engine !== "string") return { ...DEFAULT_STATE };
        return {
          engine: parsed.engine,
          model: typeof parsed.model === "string" ? parsed.model : null,
        };
      } catch (error) {
        if (error.code !== "ENOENT") log("state.unreadable");
        return { ...DEFAULT_STATE };
      }
    },
    async write(state) {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomBytes(4).toString("hex")}.tmp`;
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary, file);
    },
  };
}
