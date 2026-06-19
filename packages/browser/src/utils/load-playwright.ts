import type * as PlaywrightCore from "playwright-core";

const isModuleNotFoundError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND");

// playwright-core is heavy and optional, so it's imported on demand here — the
// one place a missing install becomes an actionable hint instead of a raw
// module-not-found stack. Keeping it dynamic also keeps it out of any bundle
// that statically imports this package: it loads only when a browser command
// actually attaches to Chrome.
export const loadPlaywright = async (): Promise<typeof PlaywrightCore> => {
  try {
    return await import("playwright-core");
  } catch (error: unknown) {
    if (!isModuleNotFoundError(error)) throw error;
    throw new Error(
      "The browser tools need playwright-core, which isn't installed. Install it with `npm i -D playwright-core`, then retry.",
    );
  }
};
