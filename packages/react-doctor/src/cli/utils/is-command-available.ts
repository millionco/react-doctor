import * as path from "node:path";
import * as fs from "node:fs";

const isWindows = process.platform === "win32";

// Candidate filenames to probe for `command` in each PATH directory. On
// Windows an executable resolves with one of the PATHEXT extensions
// (e.g. `claude.cmd`, `clip.exe`), so we also try `command + ext`; a
// command that already carries an extension is trusted as-is. Elsewhere the
// bare name is the only candidate.
const candidateFileNames = (command: string): string[] => {
  if (!isWindows || path.extname(command)) return [command];
  const pathExtensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);
  return [command, ...pathExtensions.map((extension) => `${command}${extension}`)];
};

// True when `command` resolves to an executable file on the current `PATH`.
// Shared by agent detection and the agent-handoff launcher so the
// "is this CLI installed?" check lives in one place.
export const isCommandAvailable = (command: string): boolean => {
  const pathDirectories = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  for (const directory of pathDirectories) {
    for (const fileName of candidateFileNames(command)) {
      const binaryPath = path.join(directory, fileName);
      try {
        if (!fs.statSync(binaryPath).isFile()) continue;
        // Windows has no execute bit, so X_OK is meaningless there — a file
        // matching a PATHEXT extension is considered runnable.
        if (!isWindows) fs.accessSync(binaryPath, fs.constants.X_OK);
        return true;
      } catch {}
    }
  }
  return false;
};
