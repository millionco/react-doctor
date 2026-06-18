import { isCiEnvironment } from "./is-ci-environment.js";

// TERM_PROGRAM value -> stable terminal label. The host editor/terminal sets
// this, so it survives shells launched inside it. First match wins.
const TERMINAL_BY_TERM_PROGRAM: ReadonlyArray<readonly [string, string]> = [
  ["vscode", "vscode"],
  ["iTerm.app", "iterm"],
  ["Apple_Terminal", "apple-terminal"],
  ["WezTerm", "wezterm"],
  ["ghostty", "ghostty"],
  ["Hyper", "hyper"],
  ["Tabby", "tabby"],
  ["rio", "rio"],
];

/**
 * Best-effort label for the terminal emulator / editor hosting the CLI,
 * derived from terminal-identity env vars. Recorded as the `terminalKind` run
 * tag so we can see where React Doctor is actually run (nvim, VS Code, iTerm,
 * …) — the split Sentry can't otherwise see. Low-cardinality and free of any
 * username/path/secret, so it's safe as a tag. Editor terminals (nvim/vim)
 * win over the outer emulator because that's the surface a user is reading in;
 * "ci" marks a run with no interactive terminal; "unknown" when nothing matches.
 */
export const detectTerminalKind = (env: NodeJS.ProcessEnv = process.env): string => {
  if (env.NVIM) return "neovim";
  if (env.VIM_TERMINAL) return "vim";

  const termProgram = env.TERM_PROGRAM;
  if (termProgram) {
    for (const [marker, label] of TERMINAL_BY_TERM_PROGRAM) {
      if (termProgram === marker) return label;
    }
  }

  if (env.KITTY_WINDOW_ID || env.TERM === "xterm-kitty") return "kitty";
  if (env.WT_SESSION) return "windows-terminal";
  if (env.ALACRITTY_WINDOW_ID || env.TERM === "alacritty") return "alacritty";
  if (env.VTE_VERSION) return "vte";
  if (env.TMUX) return "tmux";
  if (isCiEnvironment(env)) return "ci";
  return "unknown";
};
