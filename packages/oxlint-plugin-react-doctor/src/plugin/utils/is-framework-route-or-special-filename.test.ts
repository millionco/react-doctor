import { describe, expect, it } from "vite-plus/test";
import { isFrameworkRouteOrSpecialFilename } from "./is-framework-route-or-special-filename.js";

describe("isFrameworkRouteOrSpecialFilename", () => {
  it.each([
    ["next", "app/page.tsx"],
    ["next", "app/dashboard/layout.jsx"],
    ["next", "app/global-error.tsx"],
    ["next", "app/api/route.ts"],
    ["next", "pages/_app.tsx"],
    ["next", "pages/_document.tsx"],
    ["next", "pages/_error.jsx"],
    ["next", "pages/docs/_meta.tsx"],
    ["next", "app/opengraph-image.tsx"],
    ["next", "app/blog/twitter-image2.tsx"],
    ["next", "app/apple-icon1.tsx"],
    ["expo", "app/_layout.tsx"],
    ["expo", "src/app/(tabs)/_layout.jsx"],
    ["expo", "app/+not-found.tsx"],
    ["expo", "app/+native-intent.ts"],
    ["tanstack", "src/routes/__root.tsx"],
    ["tanstack", "src/routes/posts/$postId.lazy.tsx"],
    ["remix", "app/root.tsx"],
    ["react-router", "app/entry.client.tsx"],
    ["react-router", "app/entry.server.jsx"],
  ] as const)("recognizes %s framework route/special file %s", (runtime, filename) => {
    expect(isFrameworkRouteOrSpecialFilename(filename, runtime)).toBe(true);
  });

  it.each([
    ["generic", "app/page.tsx"],
    ["generic", "app/_layout.tsx"],
    ["next", "app/root.tsx"],
    ["expo", "app/page.tsx"],
    ["tanstack", "app/+not-found.tsx"],
    ["react-router", "pages/_document.tsx"],
    ["generic", "pages/docs/_meta.tsx"],
    ["generic", "components/Page.tsx"],
    ["generic", undefined],
  ] as const)("does not apply %s semantics to %s", (runtime, filename) => {
    expect(isFrameworkRouteOrSpecialFilename(filename, runtime)).toBe(false);
  });
});
