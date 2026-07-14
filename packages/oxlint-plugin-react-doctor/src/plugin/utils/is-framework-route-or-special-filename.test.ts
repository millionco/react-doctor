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
    expect(
      isFrameworkRouteOrSpecialFilename({ filename: `/repo/${filename}`, settings: {} }, runtime),
    ).toBe(true);
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
    ["next", "src/components/layout.tsx"],
    ["next", "src/components/page.tsx"],
    ["next", "src/components/opengraph-image.tsx"],
    ["next", "src/components/_app.tsx"],
    ["expo", "src/components/_layout.tsx"],
    ["expo", "src/components/+not-found.tsx"],
    ["expo", "src/components/app/_layout.tsx"],
  ] as const)("does not apply %s semantics to %s", (runtime, filename) => {
    expect(
      isFrameworkRouteOrSpecialFilename({ filename: `/repo/${filename}`, settings: {} }, runtime),
    ).toBe(false);
  });

  it("does not treat a project mount point as a framework directory", () => {
    expect(
      isFrameworkRouteOrSpecialFilename(
        {
          filename: "/app/project/src/components/page.tsx",
          settings: { "react-doctor": { rootDirectory: "/app/project" } },
        },
        "next",
      ),
    ).toBe(false);
    expect(
      isFrameworkRouteOrSpecialFilename(
        {
          filename: "/app/project/src/components/_layout.tsx",
          settings: { "react-doctor": { rootDirectory: "/app/project" } },
        },
        "expo",
      ),
    ).toBe(false);
  });

  it("returns false without a filename", () => {
    expect(isFrameworkRouteOrSpecialFilename({ settings: {} }, "generic")).toBe(false);
  });
});
