import { VERSION } from "../utils/version.js";

/**
 * oclif-style version line. 12-factor CLI Apps (#3, "What version am I
 * on?"): the `version` command is the primary place users grab debugging
 * info, so it carries the Node runtime and platform alongside the CLI
 * version. The `-v` / `-V` / `--version` flags stay terse (just the
 * number) so scripts can parse them.
 */
export const buildVersionString = (): string =>
  `react-doctor/${VERSION} ${process.platform}-${process.arch} node-${process.version}`;

export const versionAction = (): void => {
  process.stdout.write(`${buildVersionString()}\n`);
};
