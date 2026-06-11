import { describe, expect, it } from "vite-plus/test";
import { isFrameworkRouteOrSpecialFilename } from "./is-framework-route-or-special-filename.js";

describe("isFrameworkRouteOrSpecialFilename", () => {
  it.each([
    // Next.js App + Pages Router special files and metadata image routes.
    "app/page.tsx",
    "app/dashboard/layout.jsx",
    "app/global-error.tsx",
    "app/api/route.ts",
    "pages/_app.tsx",
    "pages/_document.tsx",
    "pages/_error.jsx",
    "app/opengraph-image.tsx",
    "app/blog/twitter-image2.tsx",
    "app/apple-icon1.tsx",
    // Expo Router.
    "app/_layout.tsx",
    "src/app/(tabs)/_layout.jsx",
    "app/+not-found.tsx",
    "app/+native-intent.ts",
    // TanStack Router / Start.
    "src/routes/__root.tsx",
    "src/routes/posts/$postId.lazy.tsx",
    // Remix / React Router.
    "app/root.tsx",
    "app/entry.client.tsx",
    "app/entry.server.jsx",
  ])("recognizes framework route/special file %s", (filename) => {
    expect(isFrameworkRouteOrSpecialFilename(filename)).toBe(true);
  });

  it.each([
    // Ordinary component / route files with no distinctive basename keep
    // going through the rule's AST / export-name detection.
    "components/Page.tsx",
    "src/layout-helpers.tsx",
    "app/index.tsx",
    "app/routes/about.tsx",
    "src/components/Root.tsx",
    "app/entry.tsx",
    "src/lazy.tsx",
    undefined,
  ])("does not recognize ordinary file %s", (filename) => {
    expect(isFrameworkRouteOrSpecialFilename(filename)).toBe(false);
  });
});
