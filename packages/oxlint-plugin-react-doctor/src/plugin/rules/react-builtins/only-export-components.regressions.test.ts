import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { onlyExportComponents } from "./only-export-components.js";

// Issue #539: a missing filename must not crash the rule. When
// `context.filename` is undefined the rule has to coalesce instead of
// calling `normalizeFilename(undefined)`, which threw
// "Cannot read properties of undefined (reading 'replaceAll')".
const AXIOS_FILE = `
import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})
`;

describe("react-builtins/only-export-components — regressions", () => {
  it("does not crash when the filename is unavailable (#539)", () => {
    expect(() => runRule(onlyExportComponents, AXIOS_FILE, { filename: undefined })).not.toThrow();
  });

  it("emits no diagnostics for a constant-only module when the filename is unknown", () => {
    const result = runRule(onlyExportComponents, AXIOS_FILE, { filename: undefined });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Issue #708: Expo Router `_layout.tsx` files should be treated as
  // entry points (same as Next.js `layout.tsx`) and skipped entirely.
  // The `Sentry.wrap(...)` default (an unrecognized HoC) plus the two
  // unexported local components are the exact "3x" diagnostics #708
  // reports; the entry-point skip must suppress all of them.
  it("skips Expo Router _layout.tsx files (#708)", () => {
    const expoLayoutFile = `
      import { lazy } from "react";
      const DeferredProviders = lazy(() => import("@/components/deferred-providers"));
      function RootLayout() {
        return <DeferredProviders />;
      }
      export default Sentry.wrap(RootLayout);
    `;
    const result = runRule(onlyExportComponents, expoLayoutFile, {
      filename: "src/app/_layout.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Issue #758: TanStack Router file routes export `Route =
  // createFileRoute(...)({ component: ProfilePage })` with the page
  // component declared locally — the router plugin owns HMR for these
  // modules, so neither the route export nor the local component is a
  // Fast Refresh hazard.
  it("skips TanStack Router createFileRoute route files (#758)", () => {
    const tanstackRouteFile = `
      import { createFileRoute } from "@tanstack/react-router";
      export const Route = createFileRoute("/_protected/profile")({
        component: ProfilePage,
      });
      function ProfilePage() {
        return <div className="p-4">Profile</div>;
      }
    `;
    const result = runRule(onlyExportComponents, tanstackRouteFile, {
      filename: "src/routes/profile.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips TanStack Router createRootRouteWithContext and lazy route factories (#758)", () => {
    const rootRouteFile = `
      import { createRootRouteWithContext } from "@tanstack/react-router";
      export const Route = createRootRouteWithContext<MyContext>()({
        component: RootComponent,
      });
      const RootComponent = () => <div>Root</div>;
    `;
    const lazyRouteFile = `
      import { createLazyFileRoute } from "@tanstack/react-router";
      export const Route = createLazyFileRoute("/about")({
        component: About,
      });
      function About() {
        return <div>About</div>;
      }
    `;
    for (const [file, filename] of [
      [rootRouteFile, "src/routes/__root.tsx"],
      [lazyRouteFile, "src/routes/about.lazy.tsx"],
    ]) {
      const result = runRule(onlyExportComponents, file, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  // React Router / Remix route modules co-export `loader` / `meta` /
  // `action` alongside the route component by framework contract.
  it("allows Remix / React Router route-module exports alongside the component (#758)", () => {
    const remixRouteFile = `
      export const loader = async () => fetchProfile();
      export const meta = () => [{ title: "Profile" }];
      export default function Profile() {
        return <div>Profile</div>;
      }
    `;
    const result = runRule(onlyExportComponents, remixRouteFile, {
      filename: "src/routes/profile.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows Next.js Pages Router data exports alongside the page component (#758)", () => {
    const nextPageFile = `
      export const getServerSideProps = async () => ({ props: {} });
      export default function ProfilePage() {
        return <div>Profile</div>;
      }
    `;
    const result = runRule(onlyExportComponents, nextPageFile, {
      filename: "pages/profile.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a data-router export alongside components (#758)", () => {
    const dataRouterFile = `
      import { createBrowserRouter } from "react-router-dom";
      export const Root = () => <div>Root</div>;
      export const router = createBrowserRouter([{ path: "/", element: <Root /> }]);
    `;
    const result = runRule(onlyExportComponents, dataRouterFile, {
      filename: "src/router-setup.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // Framework route/special files are skipped via
  // `isFrameworkRouteOrSpecialFilename`: their bundler plugins own HMR
  // and they co-export documented config/metadata next to the default
  // component. Each case co-exports a non-component value an ordinary
  // component file WOULD be flagged for, proving the skip is wired in.
  // The Next.js metadata-image cases are issue #776 (the `size` object
  // export was the original false positive).
  it.each([
    [
      "Next.js opengraph-image metadata (#776)",
      "src/app/opengraph-image.tsx",
      `import { ImageResponse } from "next/og";
       export const alt = "Open Source Showcase";
       export const size = { width: 1200, height: 630 };
       export const contentType = "image/png";
       export const revalidate = 86400;
       export default function Image() {
         return new ImageResponse(<div>OG</div>, { ...size });
       }`,
    ],
    [
      "Next.js twitter-image metadata (#776)",
      "app/about/twitter-image.tsx",
      `export const size = { width: 1200, height: 630 };
       export default function Image() {
         return <div>About</div>;
       }`,
    ],
    [
      "Next.js Pages Router _document.tsx",
      "pages/_document.tsx",
      `export const config = { amp: true };
       export default function Document() {
         return <html />;
       }`,
    ],
    [
      "Expo Router +not-found special file",
      "app/+not-found.tsx",
      `export const screenOptions = { headerShown: false };
       export default function NotFoundScreen() {
         return <View />;
       }`,
    ],
    [
      "TanStack Router __root.tsx (no factory call required)",
      "src/routes/__root.tsx",
      `export const queryClient = new QueryClient();
       export default function RootComponent() {
         return <Outlet />;
       }`,
    ],
    [
      "TanStack Router *.lazy.tsx route file",
      "src/routes/about.lazy.tsx",
      `export const routeConfig = { staleTime: 1000 };
       export default function AboutPage() {
         return <div>About</div>;
       }`,
    ],
    [
      "Remix / React Router root.tsx module",
      "app/root.tsx",
      `export const headerLinks = [{ rel: "stylesheet", href: "/app.css" }];
       export default function App() {
         return <Outlet />;
       }`,
    ],
  ])("skips framework route/special files — %s", (_label, filename, code) => {
    const result = runRule(onlyExportComponents, code, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags non-component exports in ordinary component files", () => {
    const mixedFile = `
      export const formatProfile = (profile) => profile.name.trim();
      export const ProfileCard = () => <div>Profile</div>;
    `;
    const result = runRule(onlyExportComponents, mixedFile, {
      filename: "src/components/profile-card.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
