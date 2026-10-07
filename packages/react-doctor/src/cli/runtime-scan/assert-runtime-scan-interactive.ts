import { CliInputError } from "../utils/cli-input-error.js";

export const assertRuntimeScanInteractive = (): void => {
  if (process.stdin.isTTY === true) return;
  throw new CliInputError(
    "`react-doctor scan <url>` requires an interactive terminal. Run it directly, interact with Chrome, then press Enter to stop recording.",
  );
};
