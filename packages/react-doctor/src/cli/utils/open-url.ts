import { spawn } from "node:child_process";
import process from "node:process";

// Resolves the platform's default URL opener: `open` on macOS, `start` (via
// `cmd /c`) on Windows, `xdg-open` everywhere else (Linux/BSD). Mirrors the
// `open` npm package's command selection without taking the dependency, since
// this is the only place in the CLI that needs it.
const resolveOpenCommand = (url: string): { command: string; args: string[] } => {
  if (process.platform === "darwin") return { command: "open", args: [url] };
  if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
};

// Best-effort: launches the user's default browser to `url` and returns
// whether the spawn succeeded synchronously. Detached + ignore-stdio so the
// child doesn't keep the CLI's event loop alive, and so its output never
// scribbles over the prompt we re-render afterwards. `xdg-open` may not be
// installed on minimal Linux images; callers should fall back to printing the
// URL if this returns false.
export const openUrl = (url: string): boolean => {
  try {
    const { command, args } = resolveOpenCommand(url);
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
};
