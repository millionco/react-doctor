const supportsUnicodeSymbols =
  process.platform !== "win32"
    ? process.env.TERM !== "linux"
    : Boolean(process.env.WT_SESSION) ||
      Boolean(process.env.TERMINUS_SUBLIME) ||
      process.env.ConEmuTask === "{cmd::Cmder}" ||
      process.env.TERM_PROGRAM === "Terminus-Sublime" ||
      process.env.TERM_PROGRAM === "vscode" ||
      process.env.TERM === "xterm-256color" ||
      process.env.TERM === "alacritty" ||
      process.env.TERM === "rxvt-unicode" ||
      process.env.TERM === "rxvt-unicode-256color" ||
      process.env.TERMINAL_EMULATOR === "JetBrains-JediTerm";

export const terminalSymbols = {
  pointer: supportsUnicodeSymbols ? "❯" : ">",
  pointerSmall: "›",
  radioOn: supportsUnicodeSymbols ? "◉" : "(*)",
  radioOff: supportsUnicodeSymbols ? "◯" : "( )",
};
