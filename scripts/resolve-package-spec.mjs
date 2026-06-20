import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Classify the action's `version` input into the install spec to run. Pure and
 * exported so the branch logic (local path vs registry range vs `latest`) is
 * unit-tested without the network. A local-path spec (this repo's self-test
 * runs the action against a built tarball / path) is NOT cacheable — its bytes
 * aren't keyed by a published version, so an install cache would be unsound.
 *
 * @param {string | undefined} version
 * @returns {{ cacheable: boolean, spec: string, registryRange: string | undefined }}
 */
export const classifyVersionSpec = (version) => {
  const trimmed = String(version ?? "").trim();
  const isLocalPath =
    trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/");
  if (isLocalPath) {
    return { cacheable: false, spec: trimmed, registryRange: undefined };
  }
  const range = trimmed || "latest";
  return { cacheable: true, spec: `react-doctor@${range}`, registryRange: range };
};

/**
 * Resolve a dist-tag / range (`latest`, `^2`) to the concrete published version,
 * so the install cache key is stable across runs of the same release. Network;
 * returns `null` on a registry failure / unresolvable range so the caller falls
 * back to a fresh, non-cached install rather than keying the cache on a coarse,
 * non-concrete range (which could keep restoring a stale toolchain).
 *
 * @param {string} range
 * @returns {string | null}
 */
const resolveConcreteVersion = (range) => {
  try {
    const output = execFileSync("npm", ["view", `react-doctor@${range}`, "version"], {
      encoding: "utf8",
    });
    // `npm view <range> version` prints one line per matching version for a
    // range; the last line is the highest match — the one npm would install.
    const versions = output
      .trim()
      .split("\n")
      .map((line) => line.replace(/^.*'(.+)'.*$/, "$1").trim())
      .filter(Boolean);
    return versions.length > 0 ? versions[versions.length - 1] : null;
  } catch {
    return null;
  }
};

const writeOutputs = (outputs) => {
  const rendered = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const outputPath = process.env["GITHUB_OUTPUT"];
  if (outputPath) {
    fs.appendFileSync(outputPath, `${rendered}\n`);
  } else {
    process.stdout.write(`${rendered}\n`);
  }
};

const main = () => {
  const classified = classifyVersionSpec(process.argv[2]);
  if (!classified.cacheable) {
    writeOutputs({ spec: classified.spec, resolved: "", cacheable: "false" });
    return;
  }
  const resolved = resolveConcreteVersion(classified.registryRange);
  if (resolved === null) {
    // Registry unreachable / range unresolvable — don't cache under a coarse,
    // non-concrete key (which could keep restoring a STALE toolchain across
    // failures, even after a newer release). Install the range fresh via npx.
    writeOutputs({ spec: classified.spec, resolved: "", cacheable: "false" });
    return;
  }
  writeOutputs({ spec: `react-doctor@${resolved}`, resolved, cacheable: "true" });
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
