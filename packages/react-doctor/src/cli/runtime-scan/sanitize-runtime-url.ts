import { CliInputError } from "../utils/cli-input-error.js";

export const sanitizeRuntimeUrl = (rawUrl: string): string => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new CliInputError(`Expected an absolute http(s) URL, received "${rawUrl}".`);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new CliInputError(`Expected an http(s) URL, received "${parsedUrl.protocol}".`);
  }
  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.search = "";
  parsedUrl.hash = "";
  return parsedUrl.href;
};
