import { describe, expect, it } from "vite-plus/test";
import { getReactRouterFrameworkModuleKind } from "./get-react-router-framework-module-kind.js";
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
    ["react-router", "app/routes/dashboard.tsx"],
    ["remix", "app/routes/account/profile.tsx"],
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
    ["react-router", "app/routes-helper.tsx"],
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

  it.each([
    ["app/routes/profile.tsx", undefined, "route"],
    ["src/app/routes/profile.tsx", undefined, "route"],
    ["/repo/app/routes/profile.tsx", "/repo", "route"],
    ["/repo/src/app/routes/profile.tsx", "/repo", "route"],
    ["app/root.tsx", undefined, "root"],
    ["src/app/root.tsx", undefined, "root"],
    ["/repo/app/root.tsx", "/repo", "root"],
    ["app/entry.client.tsx", undefined, "entry"],
    ["/repo/src/app/entry.server.tsx", "/repo", "entry"],
  ])("classifies React Router framework modules: %s", (filename, rootDirectory, expectedKind) => {
    expect(
      getReactRouterFrameworkModuleKind({
        filename,
        settings: rootDirectory === undefined ? {} : { "react-doctor": { rootDirectory } },
      }),
    ).toBe(expectedKind);
  });

  it.each([
    ["src/components/widget.tsx", undefined],
    ["app/components/widget.tsx", undefined],
    ["src/components/root.tsx", undefined],
    ["src/components/entry.client.tsx", undefined],
    ["src/custom-router-app/root.tsx", undefined],
    ["/repo/src/components/widget.tsx", "/repo"],
    ["/other/app/routes/widget.tsx", "/repo"],
  ])("rejects ordinary React Router modules: %s", (filename, rootDirectory) => {
    expect(
      getReactRouterFrameworkModuleKind({
        filename,
        settings: rootDirectory === undefined ? {} : { "react-doctor": { rootDirectory } },
      }),
    ).toBeNull();
  });
});
