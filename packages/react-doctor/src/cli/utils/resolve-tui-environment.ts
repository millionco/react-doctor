import { isNonInteractiveEnvironment } from "./is-non-interactive-environment.js";

export interface TuiEnvironment {
  readonly isNonInteractiveEnvironment: boolean;
  readonly nodeMajorVersion: number;
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
  readonly supportsRawMode: boolean;
  readonly terminalName?: string;
}

export const resolveTuiEnvironment = (): TuiEnvironment => ({
  isNonInteractiveEnvironment: isNonInteractiveEnvironment(),
  nodeMajorVersion: Number(process.versions.node.split(".")[0]),
  stdinIsTty: process.stdin.isTTY === true,
  stdoutIsTty: process.stdout.isTTY === true,
  supportsRawMode: typeof process.stdin.setRawMode === "function",
  terminalName: process.env.TERM,
});
