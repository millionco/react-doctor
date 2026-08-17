import { isNonInteractiveEnvironment } from "./is-non-interactive-environment.js";

export interface TuiEnvironment {
  readonly isNonInteractiveEnvironment: boolean;
  readonly nodeMajorVersion: number;
  readonly outputIsTty: boolean;
  readonly stdinIsTty: boolean;
  readonly supportsRawMode: boolean;
  readonly terminalName?: string;
}

export const resolveTuiEnvironment = (
  outputIsTty = process.stdout.isTTY === true,
): TuiEnvironment => ({
  isNonInteractiveEnvironment: isNonInteractiveEnvironment(),
  nodeMajorVersion: Number(process.versions.node.split(".")[0]),
  outputIsTty,
  stdinIsTty: process.stdin.isTTY === true,
  supportsRawMode: typeof process.stdin.setRawMode === "function",
  terminalName: process.env.TERM,
});
