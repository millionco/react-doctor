import { execFileSync } from "node:child_process";

// HACK: On Windows, Node writes UTF-8 bytes to the console, but the console
// decodes them with its active code page (CP-850/437 in cmd.exe, …), so `—`,
// `×`, `›`, and box-drawing render as mojibake (`ÔÇö`, `├ù`) — issue #956. This
// is a console *decode* mismatch, not a font/glyph-capability problem, so it
// hits even VS Code's terminal. Node has no SetConsoleOutputCP binding, so flip
// the console to UTF-8 (code page 65001) via `chcp` once at CLI startup. The
// child shares this process's console, so the change applies to our subsequent
// writes. Console-only (skipped when output is piped) and best-effort (no-op
// when there is no console, e.g. CI); the console is left at UTF-8 on exit,
// which is a sane state and the modern Windows default.
export const ensureWindowsUtf8Console = (): void => {
  if (process.platform !== "win32" || !process.stdout.isTTY) return;
  try {
    execFileSync("chcp.com", ["65001"], { stdio: "ignore" });
  } catch {}
};
