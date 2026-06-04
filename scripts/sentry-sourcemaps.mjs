import { fileURLToPath } from "node:url";
import sentryCliModule from "@sentry/cli";
import * as fs from "node:fs";
import * as path from "node:path";

// `@sentry/cli` is CommonJS exposing a single named export; pull the class off
// the interop namespace so this works as an ESM script.
const { SentryCli } = sentryCliModule;

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const PACKAGE_JSON_PATH = path.resolve(REPOSITORY_ROOT, "packages/react-doctor/package.json");
const DIST_DIRECTORY = path.resolve(REPOSITORY_ROOT, "packages/react-doctor/dist");

// Must match `resolveSentryRelease()` in the CLI's instrument.ts — the release
// the running SDK reports has to equal the release we upload artifacts under
// for stack frames to resolve.
const RELEASE_PREFIX = "react-doctor";

const REQUIRED_ENVIRONMENT_VARIABLES = ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"];

const log = (message) => console.log(`[sentry-sourcemaps] ${message}`);

const main = async () => {
  const missing = REQUIRED_ENVIRONMENT_VARIABLES.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    // Not configured (e.g. a local `pnpm release`): skip cleanly so the npm
    // publish still proceeds. CI provides these via repository secrets.
    log(`Skipping source map inject/upload — missing ${missing.join(", ")}.`);
    return;
  }

  if (!fs.existsSync(DIST_DIRECTORY)) {
    log(`Built output missing at ${DIST_DIRECTORY}; nothing to upload. Run \`pnpm build\` first.`);
    return;
  }

  const version =
    process.env.VERSION ?? JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, "utf8")).version;
  const release = `${RELEASE_PREFIX}@${version}`;

  const cli = new SentryCli(null);
  const run = async (args) => {
    log(`sentry-cli ${args.join(" ")}`);
    await cli.execute(args, true);
  };

  // `inject` rewrites dist/cli.js to embed Debug IDs (and matching IDs into the
  // .map). It runs before `changeset publish`, so the published bundle carries
  // the IDs that link it to the maps uploaded here. Maps themselves are not in
  // the npm tarball (see package.json "files"); symbolication is server-side.
  await run(["sourcemaps", "inject", DIST_DIRECTORY]);
  await run(["releases", "new", release]);
  await run(["sourcemaps", "upload", "--release", release, "--validate", DIST_DIRECTORY]);
  await run(["releases", "finalize", release]);
  log(`Uploaded source maps for ${release}.`);
};

try {
  await main();
} catch (error) {
  // Telemetry plumbing must never block shipping react-doctor to npm. Warn and
  // exit 0 so `changeset publish` still runs even if Sentry is unreachable.
  log(`Warning: source map upload failed, continuing release. ${error?.message ?? error}`);
}
