import { highlighter } from "./highlighter.js";

let isSilent = false;

export const setLoggerSilent = (silent: boolean): void => {
  isSilent = silent;
};

export const isLoggerSilent = (): boolean => isSilent;

export const logger = {
  error(...args: unknown[]) {
    if (isSilent) return;
    console.error(highlighter.error(args.join(" ")));
  },
  warn(...args: unknown[]) {
    if (isSilent) return;
    console.warn(highlighter.warn(args.join(" ")));
  },
  info(...args: unknown[]) {
    if (isSilent) return;
    console.log(highlighter.info(args.join(" ")));
  },
  success(...args: unknown[]) {
    if (isSilent) return;
    console.log(highlighter.success(args.join(" ")));
  },
  dim(...args: unknown[]) {
    if (isSilent) return;
    console.log(highlighter.dim(args.join(" ")));
  },
  log(...args: unknown[]) {
    if (isSilent) return;
    console.log(args.join(" "));
  },
  break() {
    if (isSilent) return;
    console.log("");
  },
};
