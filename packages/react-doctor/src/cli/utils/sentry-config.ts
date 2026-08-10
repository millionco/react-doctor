import { SENTRY_RELEASE_PREFIX } from "./constants.js";
import { VERSION } from "./version.js";

/**
 * Shared Sentry configuration resolution — release, environment, and tracing
 * sample rate — derived from `VERSION` and the standard `SENTRY_*` env
 * overrides. Lives apart from `instrument.ts` so this resolution remains
 * independently testable.
 */

/**
 * A version is a "dev" build when it's the unbuilt placeholder (`0.0.0`) or
 * carries a prerelease suffix (e.g. the `-dev.<sha>` snapshots published from
 * CI). Everything else is a real, tagged release.
 */
const isDevVersion = (version: string): boolean => version === "0.0.0" || version.includes("-");

/**
 * Sentry release identifier. `react-doctor@<version>` keeps it unique within
 * the org and — crucially — matches the value `scripts/sentry-sourcemaps.mjs`
 * uploads source-map artifacts under, so stack frames symbolicate. Honors the
 * standard `SENTRY_RELEASE` override.
 */
export const resolveSentryRelease = (): string =>
  process.env.SENTRY_RELEASE || `${SENTRY_RELEASE_PREFIX}@${VERSION}`;

/**
 * Deployment environment shown in Sentry's environment filter. Defaults to
 * `production` for tagged releases and `development` for dev/unbuilt versions,
 * overridable via the standard `SENTRY_ENVIRONMENT` env var.
 */
export const resolveSentryEnvironment = (): string =>
  process.env.SENTRY_ENVIRONMENT || (isDevVersion(VERSION) ? "development" : "production");
