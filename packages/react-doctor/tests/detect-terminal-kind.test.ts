import { describe, expect, it } from "vite-plus/test";
import { detectTerminalKind } from "../src/cli/utils/detect-terminal-kind.js";

// detectTerminalKind is a pure function of the env it's given (including its CI
// fallback), so each case passes an isolated env — no host var (iTerm, VS Code,
// or the CI runner this suite runs in) can leak into the assertions.
const env = (overrides: Record<string, string>): NodeJS.ProcessEnv => ({ ...overrides });

describe("detectTerminalKind", () => {
  it("reports neovim from $NVIM even inside another emulator", () => {
    expect(detectTerminalKind(env({ NVIM: "/tmp/nvim.sock", TERM_PROGRAM: "iTerm.app" }))).toBe(
      "neovim",
    );
  });

  it("reports vim from $VIM_TERMINAL", () => {
    expect(detectTerminalKind(env({ VIM_TERMINAL: "9.0" }))).toBe("vim");
  });

  it("maps known TERM_PROGRAM values to stable labels", () => {
    expect(detectTerminalKind(env({ TERM_PROGRAM: "vscode" }))).toBe("vscode");
    expect(detectTerminalKind(env({ TERM_PROGRAM: "iTerm.app" }))).toBe("iterm");
    expect(detectTerminalKind(env({ TERM_PROGRAM: "WezTerm" }))).toBe("wezterm");
    expect(detectTerminalKind(env({ TERM_PROGRAM: "Apple_Terminal" }))).toBe("apple-terminal");
    expect(detectTerminalKind(env({ TERM_PROGRAM: "ghostty" }))).toBe("ghostty");
  });

  it("detects kitty, Windows Terminal, and alacritty from their own markers", () => {
    expect(detectTerminalKind(env({ TERM: "xterm-kitty" }))).toBe("kitty");
    expect(detectTerminalKind(env({ KITTY_WINDOW_ID: "1" }))).toBe("kitty");
    expect(detectTerminalKind(env({ WT_SESSION: "abc" }))).toBe("windows-terminal");
    expect(detectTerminalKind(env({ ALACRITTY_WINDOW_ID: "1" }))).toBe("alacritty");
  });

  it("falls back to tmux, then unknown, when no emulator identifies itself", () => {
    expect(detectTerminalKind(env({ TMUX: "/tmp/tmux-1/default" }))).toBe("tmux");
    expect(detectTerminalKind(env({}))).toBe("unknown");
  });
});
