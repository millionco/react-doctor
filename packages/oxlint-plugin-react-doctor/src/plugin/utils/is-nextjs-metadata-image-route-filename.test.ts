import { describe, expect, it } from "vite-plus/test";
import { isNextjsMetadataImageRouteFilename } from "./is-nextjs-metadata-image-route-filename.js";

describe("isNextjsMetadataImageRouteFilename", () => {
  it("recognizes metadata image route filenames with supported JS/TS module extensions", () => {
    expect(isNextjsMetadataImageRouteFilename("/repo/app/opengraph-image.mjs")).toBe(true);
    expect(isNextjsMetadataImageRouteFilename("/repo/app/twitter-image2.mts")).toBe(true);
    expect(isNextjsMetadataImageRouteFilename("/repo/app/icon.mjs")).toBe(true);
    expect(isNextjsMetadataImageRouteFilename("/repo/app/apple-icon1.mts")).toBe(true);
  });

  it("does not recognize unrelated filenames", () => {
    expect(isNextjsMetadataImageRouteFilename("/repo/app/page.mjs")).toBe(false);
    expect(isNextjsMetadataImageRouteFilename(undefined)).toBe(false);
  });
});
