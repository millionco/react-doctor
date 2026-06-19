import type * as BrowserModule from "@react-doctor/browser";

const isModuleNotFoundError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND");

// playwright-core is heavy and optional, so the browser package is loaded on
// demand: `doctor_scan` works without it, and the browser tools turn a missing
// install into an actionable message instead of a stack trace.
export const loadBrowser = async (): Promise<typeof BrowserModule> => {
  try {
    return await import("@react-doctor/browser");
  } catch (error: unknown) {
    if (!isModuleNotFoundError(error)) throw error;
    throw new Error(
      "The browser tools need playwright-core, which isn't installed. Install it with `npm i -D playwright-core`, then retry.",
    );
  }
};
