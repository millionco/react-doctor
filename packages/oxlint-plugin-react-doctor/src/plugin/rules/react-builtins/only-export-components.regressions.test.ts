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

  // Fuzz FP hunt: components declared inside another function — a test
  // callback, a factory, or an object-literal `render` method — are never
  // Fast Refresh boundaries, so neither the "not exported" nor the
  // "exports nothing" message applies to them.
  it("ignores components declared inside function scopes", () => {
    const testCallbackFile = `
      declare const test: (name: string, run: () => void) => void;
      declare const render: (element: unknown) => void;
      test("renders", () => {
        const Harness = () => <div />;
        render(<Harness />);
      });
    `;
    const factoryFile = `
      function setup() {
        const Row = () => <tr />;
        return Row;
      }
      export const config = setup();
    `;
    const renderMethodFile = `
      const meta = { render: () => { const Demo = () => <div />; return <Demo />; } };
      export default meta;
    `;
    for (const [code, filename] of [
      [testCallbackFile, "src/harness.tsx"],
      [factoryFile, "src/setup-table.tsx"],
      [renderMethodFile, "src/demo-meta.tsx"],
    ]) {
      const result = runRule(onlyExportComponents, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  // Exports-only Fast-Refresh model: react-refresh's boundary check only
  // looks at what a module EXPORTS. Non-exported internal components are
  // fine; the real breaker is an export whose value is an object that
  // bundles components with (or without) other values.
  it("does not flag non-exported module-scope components", () => {
    const moduleScopeFile = `
      const Widget = () => <div />;
    `;
    const result = runRule(onlyExportComponents, moduleScopeFile, {
      filename: "src/widget.tsx",
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a config file that merely uses a local component in an exported value", () => {
    const configFile = `
      const Tab = () => <div />;
      export const tabs = [<Tab />, <Tab />];
    `;
    const result = runRule(onlyExportComponents, configFile, {
      filename: "src/tabs-config.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a named namespace-object export that bundles components with non-components", () => {
    const namespaceFile = `
      const Home = () => <div>Home</div>;
      const About = () => <div>About</div>;
      export const Pages = { Home, About, sidebarWidth: 240 };
    `;
    const result = runRule(onlyExportComponents, namespaceFile, {
      filename: "src/pages-namespace.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  it("flags a default namespace-object export carrying components", () => {
    const namespaceDefaultFile = `
      const Home = () => <div>Home</div>;
      const formatTitle = (title) => title.trim();
      export default { Home, formatTitle };
    `;
    const result = runRule(onlyExportComponents, namespaceDefaultFile, {
      filename: "src/pages-default.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  it("flags a namespace-object export with an inline PascalCase component property", () => {
    const inlineNamespaceFile = `
      export const Widgets = { Header: () => <header />, footerHeight: 64 };
    `;
    const result = runRule(onlyExportComponents, inlineNamespaceFile, {
      filename: "src/widgets.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  // PR #1093 review: HoC results stored as object properties are
  // components too — `{ Header: memo(() => …) }` bundles a component
  // exactly like `{ Header: () => … }` does.
  it("flags a namespace-object export whose component properties are HoC-wrapped", () => {
    const hocNamespaceFile = `
      import { memo } from "react";
      export const Layout = { Header: memo(() => <header />), gutter: 12 };
    `;
    const result = runRule(onlyExportComponents, hocNamespaceFile, {
      filename: "src/layout-parts.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  it("flags a default namespace-object export whose only component is HoC-wrapped", () => {
    const hocDefaultFile = `
      import { forwardRef } from "react";
      export default { Body: forwardRef((props, ref) => <div ref={ref} />) };
    `;
    const result = runRule(onlyExportComponents, hocDefaultFile, {
      filename: "src/body-parts.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  it("does not flag object properties whose calls are not HoCs", () => {
    const factoryObjectFile = `
      const createHeader = () => ({ height: 48 });
      export const layout = { Header: createHeader(), gutter: 12 };
    `;
    const result = runRule(onlyExportComponents, factoryObjectFile, {
      filename: "src/layout-config.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an HoC-valued property under a non-component key", () => {
    const camelCaseKeyFile = `
      import { memo } from "react";
      export const registry = { headerRenderer: memo(() => <header />) };
    `;
    const result = runRule(onlyExportComponents, camelCaseKeyFile, {
      filename: "src/header-registry.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // PR #1093 review: module-scope class components must join the locals
  // set so `export const Pages = { Home }` after `class Home extends
  // Component` is recognized as a namespace-object bundling a component.
  it("flags a namespace-object export referencing a local class component", () => {
    const classNamespaceFile = `
      import React from "react";
      class Home extends React.Component {
        render() {
          return <div>Home</div>;
        }
      }
      export const Pages = { Home, sidebarWidth: 240 };
    `;
    const result = runRule(onlyExportComponents, classNamespaceFile, {
      filename: "src/pages-class.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  it("flags a default namespace-object export referencing a local class component", () => {
    const classDefaultFile = `
      import { Component } from "react";
      class Home extends Component {
        render() {
          return <div>Home</div>;
        }
      }
      export default { Home };
    `;
    const result = runRule(onlyExportComponents, classDefaultFile, {
      filename: "src/pages-class-default.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  it("flags a namespace-object export referencing a class-expression component", () => {
    const classExpressionFile = `
      import React from "react";
      const Home = class extends React.PureComponent {
        render() {
          return <div>Home</div>;
        }
      };
      export const Pages = { Home };
    `;
    const result = runRule(onlyExportComponents, classExpressionFile, {
      filename: "src/pages-class-expression.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  it("does not treat non-React classes as bundled components", () => {
    const plainClassFile = `
      class HomeStore {
        state = {};
      }
      export const stores = { HomeStore };
    `;
    const result = runRule(onlyExportComponents, plainClassFile, {
      filename: "src/home-stores.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain config-object export without components", () => {
    const plainObjectFile = `
      export const ProfileCard = () => <div>Profile</div>;
      export const Home = () => <div>Home</div>;
    `;
    const configOnlyFile = `
      export const theme = { primary: "#333", spacing: 8 };
    `;
    for (const [code, filename] of [
      [plainObjectFile, "src/profile.tsx"],
      [configOnlyFile, "src/theme-config.tsx"],
    ]) {
      const result = runRule(onlyExportComponents, code, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    }
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

  // Production FP sweep: re-exports (`export { x } from './x'`) forward
  // bindings declared in ANOTHER module — there is nothing in this file
  // to move, so the mixed-export diagnostic is unactionable here. Pure
  // barrels and convenience re-exports were the dominant FP shape.
  it("does not flag pure re-export barrels", () => {
    const barrelFile = `
      export { default } from './FlexBasic';
      export { default as Flexbox } from './FlexBasic';
    `;
    const result = runRule(onlyExportComponents, barrelFile, {
      filename: "src/Flex/Flexbox.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag non-component re-exports mixed with component re-exports", () => {
    const imperativeBarrel = `
      export { ContextMenuHost } from './ContextMenuHost';
      export { closeContextMenu, showContextMenu } from './store';
    `;
    const result = runRule(onlyExportComponents, imperativeBarrel, {
      filename: "src/base-ui/ContextMenu/imperative.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a convenience re-export alongside a local component", () => {
    const componentWithReExport = `
      export { parseTrigger } from '@/utils/parseTrigger';
      export const Popover = () => <div />;
    `;
    const result = runRule(onlyExportComponents, componentWithReExport, {
      filename: "src/base-ui/Popover/Popover.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags locally-declared non-components exported via a specifier block", () => {
    const localSpecifierFile = `
      const formatLabel = (value) => value.trim();
      export const Card = () => <div />;
      export { formatLabel };
    `;
    const result = runRule(onlyExportComponents, localSpecifierFile, {
      filename: "src/components/card.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // Fuzz edge-case audit 2026-07: a PascalCase name alone is a heuristic.
  // Namespace-object detection requires render-output evidence from a
  // directly-inspectable function body, so a formatter map whose helpers
  // happen to be PascalCase-named is not a component bundle.
  it("does not flag an exported object of PascalCase formatter functions (no render output)", () => {
    const formatterMapFile = `
      const FormatDate = (date) => date.toISOString();
      export const formatters = {
        FormatDate,
        ShortTime: (date) => date.toLocaleTimeString(),
        locale: "en-US",
      };
    `;
    const result = runRule(onlyExportComponents, formatterMapFile, {
      filename: "src/format-map.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a namespace-object export bundling only components (no other members needed)", () => {
    const componentsOnlyNamespaceFile = `
      const Home = () => <div>Home</div>;
      const About = () => <div>About</div>;
      export const Pages = { Home, About };
    `;
    const result = runRule(onlyExportComponents, componentsOnlyNamespaceFile, {
      filename: "src/pages.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bundles components inside an object");
  });

  it("flags a namespace-object export reaching a component through a spread sibling", () => {
    const spreadNamespaceFile = `
      const Home = () => <div>Home</div>;
      export const Pages = { ...basePages, Home };
    `;
    const result = runRule(onlyExportComponents, spreadNamespaceFile, {
      filename: "src/pages-spread.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still detects HOC-wrapped local components inside a namespace-object export", () => {
    const memoNamespaceFile = `
      const Home = memo(() => <div>Home</div>);
      export const Pages = { Home, sidebarWidth: 240 };
    `;
    const result = runRule(onlyExportComponents, memoNamespaceFile, {
      filename: "src/pages-memo.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // `export default factory({ … })` — an unknown factory fed only config
  // objects is a library definition (SDK registrations, route manifests),
  // not an unnamed component (fuzz FP hunt: twenty front-components).
  describe("config-object factory default exports", () => {
    it("does not flag a default-exported config factory call", () => {
      const configFactoryFile = `
        import { defineFrontComponent } from "twenty-sdk/define";
        const ContributorStats = () => <div />;
        export default defineFrontComponent({
          name: "Contributor Stats",
          component: ContributorStats,
        });
      `;
      const result = runRule(onlyExportComponents, configFactoryFile, {
        filename: "src/contributor-stats.front-component.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it("reports the mixed boundary when a component export sits beside the factory", () => {
      const mixedFile = `
        import { defineFrontComponent } from "twenty-sdk/define";
        export const Stats = () => <div />;
        export default defineFrontComponent({ name: "Stats" });
      `;
      const result = runRule(onlyExportComponents, mixedFile, {
        filename: "src/stats.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("exports non-components");
    });

    it("still flags an anonymous component wrapped in a known HOC", () => {
      const anonymousMemoFile = `export default memo(() => <div />);`;
      const result = runRule(onlyExportComponents, anonymousMemoFile, {
        filename: "src/anonymous.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("unnamed");
    });

    it("still flags an unknown curried HOC wrapping a component identifier", () => {
      const curriedFile = `
        const MainView = () => <div />;
        export default compose()(MainView);
      `;
      const result = runRule(onlyExportComponents, curriedFile, {
        filename: "src/main-view.tsx",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // Modern Vite Fast Refresh treats `use[A-Z]*` exports as refresh
  // boundaries alongside components, so a hook export next to the
  // component is not a hazard.
  it("does not flag a custom-hook export alongside a component", () => {
    const hookAndComponentFile = `
      export const useToggle = () => useState(false);
      export const Switch = () => <button />;
    `;
    const result = runRule(onlyExportComponents, hookAndComponentFile, {
      filename: "src/components/switch-control.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
