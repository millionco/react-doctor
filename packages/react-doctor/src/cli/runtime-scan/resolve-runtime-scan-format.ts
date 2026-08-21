import { CliInputError } from "../utils/cli-input-error.js";

export const resolveRuntimeScanFormat = (format: string | undefined): "text" | "json" | "jsonl" => {
  if (format === undefined || format === "text") return "text";
  if (format === "json" || format === "jsonl") return format;
  throw new CliInputError(`--format must be one of: text, json, jsonl. Received "${format}".`);
};
