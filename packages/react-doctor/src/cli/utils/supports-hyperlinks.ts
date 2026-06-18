import { MINIMUM_VTE_VERSION_FOR_HYPERLINKS } from "./constants.js";
import { isCiEnvironment } from "./is-ci-environment.js";

// TERM_PROGRAM values for terminals that render OSC 8 hyperlinks. Conservative
// allowlist: a terminal not on it is treated as incapable so the escape bytes
// never leak as visible garbage in an older emulator.
const HYPERLINK_CAPABLE_TERM_PROGRAMS = new Set([
  "iTerm.app",
  "WezTerm",
  "vscode",
  "Hyper",
  "ghostty",
  "Tabby",
  "rio",
]);

const parseVteVersion = (raw: string | undefined): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/**
 * Whether `stream` is a terminal that renders OSC 8 hyperlinks. Auto-detected
 * from terminal-identity env vars; the de-facto `FORCE_HYPERLINK` env var
 * overrides detection (`FORCE_HYPERLINK=0`/`false` forces off, any other value
 * forces on), mirroring how the ecosystem's terminal libraries gate the same
 * feature. Off for non-TTYs, `TERM=dumb`, and CI (whose log viewers render the
 * raw escape rather than a link). Unknown terminals default to off.
 */
export const supportsHyperlinks = (
  stream: NodeJS.WriteStream = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): boolean => {
  const forced = env.FORCE_HYPERLINK;
  if (forced !== undefined && forced !== "") {
    return forced !== "0" && forced.toLowerCase() !== "false";
  }

  if (stream.isTTY !== true) return false;
  if (env.TERM === "dumb") return false;
  if (isCiEnvironment(env)) return false;

  if (env.WT_SESSION) return true;
  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty") return true;
  if (parseVteVersion(env.VTE_VERSION) >= MINIMUM_VTE_VERSION_FOR_HYPERLINKS) return true;
  return Boolean(env.TERM_PROGRAM && HYPERLINK_CAPABLE_TERM_PROGRAMS.has(env.TERM_PROGRAM));
};
