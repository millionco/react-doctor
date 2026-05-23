import { highlighter, type LoggerWriter } from "@react-doctor/core";
import { VERSION } from "./version.js";

// Single branded line every command prints first when not in JSON/score
// mode. Keeps the visual signature consistent across `inspect`, `install`,
// and any future subcommand.
export const printBrandedHeader = (logger: LoggerWriter): void => {
  logger.log(`${highlighter.bold("react-doctor")} ${highlighter.dim(`v${VERSION}`)}`);
  logger.break();
};
