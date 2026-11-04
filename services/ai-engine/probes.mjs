import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { childEnvironment, runCli } from "./runner.mjs";

const PROBE_TIMEOUT_MS = 20_000;
const PROBE_MAX_AGE_MS = 5 * 60_000;

/** Finds each CLI and asks it for its version, login state and models. */
export function createProbes(config) {
  const probes = new Map();

  async function resolveBinary(engine) {
    const candidates = config.binaries[engine.id]
      ? [config.binaries[engine.id]]
      : (config.parentEnv.PATH ?? "")
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, engine.binaryName));
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.X_OK);
        const info = await stat(candidate);
        if (!info.isFile()) continue;
        return {
          path: candidate,
          signature: `${await realpath(candidate)}:${info.mtimeMs}:${info.size}`,
        };
      } catch {
        // Not here. The next folder may have it.
      }
    }
    return null;
  }

  const runProbe = (engine, binary, args) =>
    runCli({
      binary,
      args,
      cwd: tmpdir(),
      env: childEnvironment(config.parentEnv, engine.envNames),
      timeoutMs: PROBE_TIMEOUT_MS,
      killGraceMs: config.killGraceMs,
      maxOutputBytes: 1024 * 1024,
    });

  async function loadProbe(engine) {
    const binary = await resolveBinary(engine);
    if (!binary)
      return {
        installed: false,
        version: null,
        signedIn: false,
        models: engine.fallbackModels,
        at: Date.now(),
      };
    const [version, signIn, models] = await Promise.all([
      runProbe(engine, binary.path, engine.versionArgs),
      runProbe(engine, binary.path, engine.signInArgs),
      engine.modelsArgs
        ? runProbe(engine, binary.path, engine.modelsArgs)
        : null,
    ]);
    const listed = models?.code === 0 ? engine.parseModels(models.stdout) : [];
    return {
      installed: true,
      version: /\d+\.\d+\.\d+/.exec(version.stdout)?.[0] ?? null,
      signedIn: engine.signedInFromCheck(signIn),
      models: listed.length ? listed : engine.fallbackModels,
      at: Date.now(),
    };
  }

  /** Slow CLI checks are cached. A stale value is served while it refreshes. */
  async function getProbe(engine, { fresh = false } = {}) {
    const entry = probes.get(engine.id);
    const stale = !entry || Date.now() - entry.value?.at > PROBE_MAX_AGE_MS;
    if (stale && !entry?.pending) {
      const pending = loadProbe(engine)
        .then((value) => {
          probes.set(engine.id, { value });
          return value;
        })
        .catch(() => {
          probes.set(engine.id, { value: entry?.value });
          return entry?.value;
        });
      probes.set(engine.id, { value: entry?.value, pending });
    }
    const current = probes.get(engine.id);
    if (current.pending && (fresh || !current.value)) return current.pending;
    return current.value;
  }

  return { resolveBinary, getProbe };
}
