import { CliInputError } from "../utils/cli-input-error.js";
import { RUNTIME_SCAN_SAFE_CDP_PAGE_URLS } from "./constants.js";

const safeCdpPageUrls = new Set<string>(RUNTIME_SCAN_SAFE_CDP_PAGE_URLS);

export const assertRuntimeScanCdpProfile = (pageUrls: ReadonlyArray<string>): void => {
  if (pageUrls.every((pageUrl) => safeCdpPageUrls.has(pageUrl))) return;
  throw new CliInputError(
    "Chrome performance tracing includes every open tab. Close all tabs in the dedicated debug profile and retry; a blank new tab can stay open.",
  );
};
