import { agy } from "./agy.mjs";
import { claude } from "./claude.mjs";
import { codex } from "./codex.mjs";

export const engines = { agy, claude, codex };
export const API_ENGINE = "api";
export const ENGINE_IDS = [API_ENGINE, ...Object.keys(engines)];
