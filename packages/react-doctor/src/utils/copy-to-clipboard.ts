import { spawnSync } from "node:child_process";
import type { ClipboardCommand } from "../types.js";

const getClipboardCommands = (): ClipboardCommand[] => {
  if (process.platform === "darwin") {
    return [{ command: "pbcopy", args: [] }];
  }

  if (process.platform === "win32") {
    return [{ command: "clip", args: [] }];
  }

  return [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
};

export const copyToClipboard = (text: string): boolean => {
  const clipboardCommands = getClipboardCommands();

  for (const clipboardCommand of clipboardCommands) {
    const clipboardProcess = spawnSync(clipboardCommand.command, clipboardCommand.args, {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
      encoding: "utf8",
    });

    if (clipboardProcess.status === 0) {
      return true;
    }
  }

  return false;
};
