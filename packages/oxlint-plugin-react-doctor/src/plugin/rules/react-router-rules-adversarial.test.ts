import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { reactRouterV8NoMetaDataField } from "./architecture/react-router-v8-no-meta-data-field.js";
import { reactRouterV8NoReactRouterDomImport } from "./architecture/react-router-v8-no-react-router-dom-import.js";
import { reactRouterV8NoRemovedFutureFlags } from "./architecture/react-router-v8-no-removed-future-flags.js";
import { reactRouterGuardAbortedHandleError } from "./correctness/react-router-guard-aborted-handle-error.js";
import { reactRouterNoEmptyLeafRoute } from "./correctness/react-router-no-empty-leaf-route.js";
import { reactRouterNoInvalidSplatPath } from "./correctness/react-router-no-invalid-splat-path.js";
import { reactRouterNoMiddlewareResponseBodyConsumption } from "./correctness/react-router-no-middleware-response-body-consumption.js";
import { reactRouterNoMultipleBlockers } from "./correctness/react-router-no-multiple-blockers.js";
import { reactRouterNoNestedRouter } from "./correctness/react-router-no-nested-router.js";
import { reactRouterNoStaticCookieExpires } from "./correctness/react-router-no-static-cookie-expires.js";
import { reactRouterResourceLinkRequiresReload } from "./correctness/react-router-resource-link-requires-reload.js";
import { reactRouterReturnNavigationPromiseInTransition } from "./correctness/react-router-return-navigation-promise-in-transition.js";
import { reactRouterSessionMutationRequiresCommit } from "./correctness/react-router-session-mutation-requires-commit.js";
import { reactRouterValidRouteObject } from "./correctness/react-router-valid-route-object.js";
import { reactRouterCspNonceConsistency } from "./security/react-router-csp-nonce-consistency.js";

const FRAMEWORK_ROUTE_OPTIONS = {
  filename: "/project/app/routes/dashboard.tsx",
  settings: { "react-doctor": { capabilities: ["react-router-framework"] } },
};

const FRAMEWORK_SERVER_ENTRY_OPTIONS = {
  filename: "/project/app/entry.server.tsx",
  settings: { "react-doctor": { capabilities: ["react-router-framework"] } },
};

const V8_FRAMEWORK_CONFIG_OPTIONS = {
  filename: "/project/react-router.config.ts",
  settings: {
    "react-doctor": { capabilities: ["react-router:8", "react-router-framework"] },
  },
};

describe("React Router adversarial rule contracts", () => {
  it("accepts immutable aliases of one CSP nonce", () => {
    const result = runRule(
      reactRouterCspNonceConsistency,
      'import { ServerRouter } from "react-router"; import { renderToPipeableStream } from "react-dom/server"; export const render = (request, context, nonce) => { const routerNonce = nonce; const streamNonce = routerNonce; return renderToPipeableStream(<ServerRouter context={context} url={request.url} nonce={routerNonce} />, { nonce: streamNonce }); };',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("checks each server render against its own ServerRouter", () => {
    const result = runRule(
      reactRouterCspNonceConsistency,
      'import { ServerRouter } from "react-router"; import { renderToPipeableStream } from "react-dom/server"; export const first = (context, firstNonce, otherNonce) => renderToPipeableStream(<ServerRouter context={context} nonce={firstNonce} />, { nonce: otherNonce }); export const second = (context, nonce) => renderToPipeableStream(<ServerRouter context={context} nonce={nonce} />, { nonce });',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores reporting calls inside an uninvoked nested function", () => {
    const result = runRule(
      reactRouterGuardAbortedHandleError,
      "export function handleError(error, { request }) { const reportLater = () => console.error(error); if (request.signal.aborted) return; }",
      FRAMEWORK_SERVER_ENTRY_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores unrelated imported namespace methods named reportError", () => {
    const result = runRule(
      reactRouterGuardAbortedHandleError,
      'import * as validation from "./validation"; export function handleError(error, { request }) { validation.reportError(error); }',
      FRAMEWORK_SERVER_ENTRY_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows an intentional absolute cookie expiration", () => {
    const result = runRule(
      reactRouterNoStaticCookieExpires,
      'import { createCookie } from "react-router"; export const cookie = createCookie("campaign", { expires: new Date("2030-01-01T00:00:00Z") });',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires a proven resource route before reporting a resource link", () => {
    const result = runRule(
      reactRouterResourceLinkRequiresReload,
      'import { createBrowserRouter, Link } from "react-router"; createBrowserRouter([{ path: "/release-notes.pdf", element: <ReleaseNotes /> }]); export const Navigation = () => <Link to="/release-notes.pdf">Notes</Link>;',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a link to a proven resource route", () => {
    const result = runRule(
      reactRouterResourceLinkRequiresReload,
      'import { createBrowserRouter, Link } from "react-router"; createBrowserRouter([{ path: "/report", loader: loadReport }]); export const Navigation = () => <Link to="/report">Report</Link>;',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an undefined loader as a resource route", () => {
    const result = runRule(
      reactRouterResourceLinkRequiresReload,
      'import { createBrowserRouter, Link } from "react-router"; createBrowserRouter([{ path: "/report.pdf", loader: undefined }]); export const Navigation = () => <Link to="/report.pdf">Report</Link>;',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("abstains when a file contains mixed transition provider modes", () => {
    const result = runRule(
      reactRouterReturnNavigationPromiseInTransition,
      'import { startTransition } from "react"; import { RouterProvider, useNavigate } from "react-router"; export const Apps = ({ first, second }) => <><RouterProvider router={first} useTransitions /><RouterProvider router={second} /></>; export const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => { navigate("/next"); })} />; };',
      { settings: { "react-doctor": { capabilities: ["react-router:7.15"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires the serialized session cookie to reach Set-Cookie", () => {
    const result = runRule(
      reactRouterSessionMutationRequiresCommit,
      'import { createCookieSessionStorage } from "react-router"; const { getSession, commitSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); await commitSession(session); return redirect("/"); }',
      FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a serialized session cookie assigned before Set-Cookie", () => {
    const result = runRule(
      reactRouterSessionMutationRequiresCommit,
      'import { createCookieSessionStorage } from "react-router"; const { getSession, commitSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); const cookie = await commitSession(session); return redirect("/", { headers: { "Set-Cookie": cookie } }); }',
      FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects a serialized session cookie overwritten before Set-Cookie", () => {
    const result = runRule(
      reactRouterSessionMutationRequiresCommit,
      'import { createCookieSessionStorage } from "react-router"; const { getSession, commitSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); let cookie = await commitSession(session); cookie = ""; return redirect("/", { headers: { "Set-Cookie": cookie } }); }',
      FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("only checks future flags on the exported React Router config", () => {
    const result = runRule(
      reactRouterV8NoRemovedFutureFlags,
      "const plugin = { future: { v8_middleware: true } }; export default { plugins: [plugin] };",
      V8_FRAMEWORK_CONFIG_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports every removed v8 future flag on an aliased default config", () => {
    const result = runRule(
      reactRouterV8NoRemovedFutureFlags,
      "const config = { future: { v8_middleware: true, unstable_previewServerPrerendering: true } }; export default config;",
      V8_FRAMEWORK_CONFIG_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts explicitly undefined route properties", () => {
    const result = runRule(
      reactRouterValidRouteObject,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ index: true, path: undefined, children: undefined, Component: undefined, element: <Home /> }]);',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows an index route with a path", () => {
    const result = runRule(
      reactRouterValidRouteObject,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ index: true, path: "home", element: <Home /> }]);',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("rejects an index route with active children", () => {
    const result = runRule(
      reactRouterValidRouteObject,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ index: true, children: [{ path: "child", element: <Child /> }] }]);',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an empty UI leaf but allows a resource leaf", () => {
    const invalidResult = runRule(
      reactRouterNoEmptyLeafRoute,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/empty" }]);',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    const validResult = runRule(
      reactRouterNoEmptyLeafRoute,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/feed.xml", loader: loadFeed }]);',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(invalidResult.diagnostics).toHaveLength(1);
    expect(validResult.diagnostics).toEqual([]);
  });

  it("reports a leaf whose only content and handler values are undefined", () => {
    const result = runRule(
      reactRouterNoEmptyLeafRoute,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/empty", element: undefined, loader: undefined }]);',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports only splats outside the final complete segment", () => {
    const invalidResult = runRule(
      reactRouterNoInvalidSplatPath,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: ("/files/*/edit" as const), element: <Editor /> }]);',
    );
    const validResult = runRule(
      reactRouterNoInvalidSplatPath,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: ("/files/*" satisfies string), element: <Files /> }]);',
    );
    expect(invalidResult.diagnostics).toHaveLength(1);
    expect(validResult.diagnostics).toEqual([]);
  });

  it("respects stable blocker version boundaries", () => {
    const source =
      'import { useBlocker } from "react-router"; export const Form = () => { useBlocker(true); useBlocker(false); return null; };';
    const stableResult = runRule(reactRouterNoMultipleBlockers, source, {
      settings: { "react-doctor": { capabilities: ["react-router:6.19"] } },
    });
    const earlierResult = runRule(reactRouterNoMultipleBlockers, source, {
      settings: { "react-doctor": { capabilities: ["react-router:6.7"] } },
    });
    expect(stableResult.diagnostics).toHaveLength(1);
    expect(earlierResult.diagnostics).toEqual([]);
  });

  it("reports aliased nested routers but allows sibling routers", () => {
    const invalidResult = runRule(
      reactRouterNoNestedRouter,
      'import { BrowserRouter as Outer, MemoryRouter as Inner } from "react-router"; export const App = () => <Outer><Inner /></Outer>;',
    );
    const validResult = runRule(
      reactRouterNoNestedRouter,
      'import { BrowserRouter, MemoryRouter } from "react-router"; export const Apps = () => <><BrowserRouter /><MemoryRouter /></>;',
    );
    expect(invalidResult.diagnostics).toHaveLength(1);
    expect(validResult.diagnostics).toEqual([]);
  });

  it("reports v8 meta data fields and declares the v8 gate", () => {
    const source = "export function meta({ data }) { return [{ title: data.title }]; }";
    const v8Result = runRule(reactRouterV8NoMetaDataField, source, {
      filename: "/project/app/routes/home.tsx",
      settings: {
        "react-doctor": { capabilities: ["react-router:8", "react-router-framework"] },
      },
    });
    expect(v8Result.diagnostics).toHaveLength(1);
    expect(reactRouterV8NoMetaDataField.requires).toContain("react-router:8");
  });

  it("reports react-router-dom and declares the v8 gate", () => {
    const source =
      'import { Link } from "react-router-dom"; export { redirect } from "react-router-dom";';
    const v8Result = runRule(reactRouterV8NoReactRouterDomImport, source, {
      settings: { "react-doctor": { capabilities: ["react-router:8"] } },
    });
    expect(v8Result.diagnostics).toHaveLength(2);
    expect(reactRouterV8NoReactRouterDomImport.requires).toContain("react-router:8");
  });

  it("allows body reads from a cloned middleware response", () => {
    const result = runRule(
      reactRouterNoMiddlewareResponseBodyConsumption,
      "export const middleware = [async (_context, next) => { const response = await next(); const data = await response.clone().json(); record(data); return response; }];",
      {
        settings: {
          "react-doctor": { capabilities: ["react-router:7.9", "react-router-framework"] },
        },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
