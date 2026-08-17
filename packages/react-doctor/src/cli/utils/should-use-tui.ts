import type { InspectFlags } from "./inspect-flags.js";
import { TUI_MIN_NODE_MAJOR_VERSION } from "./constants.js";
import type { TuiEnvironment } from "./resolve-tui-environment.js";

export interface ShouldUseTuiInput extends TuiEnvironment {
  readonly flags: InspectFlags;
}

export const isTuiEnvironmentSupported = (input: TuiEnvironment): boolean =>
  !input.isNonInteractiveEnvironment &&
  input.stdinIsTty &&
  input.outputIsTty &&
  input.supportsRawMode &&
  input.nodeMajorVersion >= TUI_MIN_NODE_MAJOR_VERSION &&
  input.terminalName !== "dumb";

export const shouldUseTui = (input: ShouldUseTuiInput): boolean => {
  if (!isTuiEnvironmentSupported(input)) return false;
  const flags = input.flags;
  const requiresHeadlessRenderer =
    flags.score === true ||
    flags.json === true ||
    flags.jsonCompact === true ||
    flags.jsonOut !== undefined ||
    flags.staged === true ||
    flags.changedFilesFrom !== undefined;
  return !requiresHeadlessRenderer;
};
