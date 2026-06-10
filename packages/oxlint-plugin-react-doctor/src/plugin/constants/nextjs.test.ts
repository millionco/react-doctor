import { describe, expect, it } from "vite-plus/test";
import {
  ERROR_BOUNDARY_FILE_PATTERN,
  GLOBAL_ERROR_FILE_PATTERN,
  OG_IMAGE_FILE_PATTERN,
  PAGE_FILE_PATTERN,
  PAGE_OR_LAYOUT_FILE_PATTERN,
  ROUTE_HANDLER_FILE_PATTERN,
} from "./nextjs.js";

describe("Next.js filename patterns", () => {
  it("recognizes supported JS/TS module extensions", () => {
    expect(PAGE_FILE_PATTERN.test("/repo/app/page.mjs")).toBe(true);
    expect(PAGE_OR_LAYOUT_FILE_PATTERN.test("/repo/app/layout.mts")).toBe(true);
    expect(ROUTE_HANDLER_FILE_PATTERN.test("/repo/app/api/route.mjs")).toBe(true);
    expect(ERROR_BOUNDARY_FILE_PATTERN.test("/repo/app/error.mts")).toBe(true);
    expect(GLOBAL_ERROR_FILE_PATTERN.test("/repo/app/global-error.mjs")).toBe(true);
    expect(OG_IMAGE_FILE_PATTERN.test("/repo/app/opengraph-image2.mts")).toBe(true);
  });

  it("does not recognize unsupported CommonJS module extensions", () => {
    expect(PAGE_FILE_PATTERN.test("/repo/app/page.cjs")).toBe(false);
    expect(ROUTE_HANDLER_FILE_PATTERN.test("/repo/app/api/route.cts")).toBe(false);
  });
});
