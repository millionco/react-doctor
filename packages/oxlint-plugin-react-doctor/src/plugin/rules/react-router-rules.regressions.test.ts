import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import type { Rule } from "../utils/rule.js";
import { reactRouterCspNonceConsistency } from "./security/react-router-csp-nonce-consistency.js";
import { reactRouterGuardAbortedHandleError } from "./correctness/react-router-guard-aborted-handle-error.js";
import { reactRouterDescendantRoutesRequireSplat } from "./correctness/react-router-descendant-routes-require-splat.js";
import { reactRouterInternalRouteAnchor } from "./correctness/react-router-internal-route-anchor.js";
import { reactRouterLoaderFetchForwardsSignal } from "./performance/react-router-loader-fetch-forwards-signal.js";
import { reactRouterLoaderParallelFetch } from "./performance/react-router-loader-parallel-fetch.js";
import { reactRouterPreferRouteLazy } from "./performance/react-router-prefer-route-lazy.js";
import { reactRouterNoCatchMiddlewareNext } from "./correctness/react-router-no-catch-middleware-next.js";
import { reactRouterNoClientModuleInServerRender } from "./correctness/react-router-no-client-module-in-server-render.js";
import { reactRouterNoDuplicateRouteId } from "./correctness/react-router-no-duplicate-route-id.js";
import { reactRouterNoInvalidAbsoluteChildPath } from "./correctness/react-router-no-invalid-absolute-child-path.js";
import { reactRouterNoInvalidLazyRouteProperties } from "./correctness/react-router-no-invalid-lazy-route-properties.js";
import { reactRouterNoLoaderRequestBody } from "./correctness/react-router-no-loader-request-body.js";
import { reactRouterNoMiddlewareResponseBodyConsumption } from "./correctness/react-router-no-middleware-response-body-consumption.js";
import { reactRouterNoMultipleMiddlewareNext } from "./correctness/react-router-no-multiple-middleware-next.js";
import { reactRouterNoMultipleSetSearchParamsInTick } from "./correctness/react-router-no-multiple-set-search-params-in-tick.js";
import { reactRouterNoNavigateInRender } from "./correctness/react-router-no-navigate-in-render.js";
import { reactRouterNestedRouteRequiresOutlet } from "./correctness/react-router-nested-route-requires-outlet.js";
import { reactRouterNoRedirectInTryCatch } from "./correctness/react-router-no-redirect-in-try-catch.js";
import { reactRouterNoRouteModuleEnvironmentSuffix } from "./correctness/react-router-no-route-module-environment-suffix.js";
import { reactRouterNoRouterInRender } from "./correctness/react-router-no-router-in-render.js";
import { reactRouterNoSessionMutationInLoader } from "./correctness/react-router-no-session-mutation-in-loader.js";
import { reactRouterNoStaticCookieExpires } from "./correctness/react-router-no-static-cookie-expires.js";
import { reactRouterNoUnsynchronizedSearchParamsMutation } from "./correctness/react-router-no-unsynchronized-search-params-mutation.js";
import { reactRouterNoUseLoaderDataInErrorUi } from "./correctness/react-router-no-use-loader-data-in-error-ui.js";
import { reactRouterRequireRootErrorBoundary } from "./correctness/react-router-require-root-error-boundary.js";
import { reactRouterResourceLinkRequiresReload } from "./correctness/react-router-resource-link-requires-reload.js";
import { reactRouterReturnNavigationPromiseInTransition } from "./correctness/react-router-return-navigation-promise-in-transition.js";
import { reactRouterServerMiddlewareReturnResponse } from "./correctness/react-router-server-middleware-return-response.js";
import { reactRouterSessionMutationRequiresCommit } from "./correctness/react-router-session-mutation-requires-commit.js";
import { reactRouterValidRouteObject } from "./correctness/react-router-valid-route-object.js";

interface SafeRuleCase {
  name: string;
  rule: Rule;
  source: string;
  filename?: string;
  settings?: Readonly<Record<string, unknown>>;
}

const REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS = {
  filename: "/project/app/routes/dashboard.tsx",
  settings: { "react-doctor": { capabilities: ["react-router-framework"] } },
};

const REACT_ROUTER_FRAMEWORK_SERVER_ENTRY_OPTIONS = {
  filename: "/project/app/entry.server.tsx",
  settings: { "react-doctor": { capabilities: ["react-router-framework"] } },
};

const safeRuleCases: SafeRuleCase[] = [
  {
    name: "ignores a shadowed router factory",
    rule: reactRouterNoRouterInRender,
    source:
      'import { createBrowserRouter } from "react-router"; function App() { const createBrowserRouter = () => null; createBrowserRouter(); return null; }',
  },
  {
    name: "allows navigate in an event handler",
    rule: reactRouterNoNavigateInRender,
    source:
      'import { useNavigate } from "react-router"; function App() { const navigate = useNavigate(); return <button onClick={() => navigate("/next")} />; }',
  },
  {
    name: "allows useOutlet as a nested route render point",
    rule: reactRouterNestedRouteRequiresOutlet,
    source:
      'import { createBrowserRouter, useOutlet as useChildOutlet } from "react-router"; createBrowserRouter([{ Component: () => <main>{useChildOutlet()}</main>, children: [{ path: "child", element: <Child /> }] }]);',
  },
  {
    name: "ignores explicitly falsy nested route children",
    rule: reactRouterNestedRouteRequiresOutlet,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ Component: () => <main />, children: null }, { Component: () => <main />, children: undefined }, { Component: () => <main />, children: false }]);',
  },
  {
    name: "allows an inline route component to delegate to a layout component",
    rule: reactRouterNestedRouteRequiresOutlet,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ Component: () => <Layout />, children: [{ path: "child", element: <Child /> }] }]);',
  },
  {
    name: "allows a nested route element to delegate through an intrinsic wrapper",
    rule: reactRouterNestedRouteRequiresOutlet,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ element: <main><Layout /></main>, children: [{ path: "child", element: <Child /> }] }]);',
  },
  {
    name: "allows a nested route element to delegate through a fragment",
    rule: reactRouterNestedRouteRequiresOutlet,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ element: <><header /><Layout /></>, children: [{ path: "child", element: <Child /> }] }]);',
  },
  {
    name: "allows lazy to return mutable route properties",
    rule: reactRouterNoInvalidLazyRouteProperties,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", lazy: async () => ({ Component, loader }) }]);',
  },
  {
    name: "allows every lazy return path to use mutable route properties",
    rule: reactRouterNoInvalidLazyRouteProperties,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", lazy: async () => { if (compact) return { Component }; return { loader }; } }]);',
  },
  {
    name: "ignores helper objects named lazy inside route implementations",
    rule: reactRouterNoInvalidLazyRouteProperties,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", Component: () => { const helper = { lazy: async () => ({ path: "/changed" }) }; return <button onClick={helper.lazy} />; } }]);',
  },
  {
    name: "allows request bodies in actions",
    rule: reactRouterNoLoaderRequestBody,
    source: "export async function action({ request }) { return request.formData(); }",
  },
  {
    name: "ignores unrelated object methods named loader",
    rule: reactRouterNoLoaderRequestBody,
    source:
      "const parser = { async loader({ request }) { return request.formData(); } }; export default parser;",
  },
  {
    name: "ignores exported loader helpers in data mode",
    rule: reactRouterNoLoaderRequestBody,
    source: "export async function loader({ request }) { return request.formData(); }",
    filename: "/project/src/data.ts",
    settings: { "react-doctor": { capabilities: ["react-router:6.4"] } },
  },
  {
    name: "ignores exported loader helpers outside framework route modules",
    rule: reactRouterNoLoaderRequestBody,
    source: "export async function loader({ request }) { return request.formData(); }",
    filename: "/project/app/utils/data.ts",
    settings: { "react-doctor": { capabilities: ["react-router-framework"] } },
  },
  {
    name: "allows pure error formatting without an abort guard",
    rule: reactRouterGuardAbortedHandleError,
    source: "export function handleError(error, { request }) { return formatError(error); }",
    ...REACT_ROUTER_FRAMEWORK_SERVER_ENTRY_OPTIONS,
  },
  {
    name: "allows an early return for aborted requests before error reporting",
    rule: reactRouterGuardAbortedHandleError,
    source:
      "export function handleError(error, { request }) { if (request.signal.aborted) return; console.error(error); }",
    ...REACT_ROUTER_FRAMEWORK_SERVER_ENTRY_OPTIONS,
  },
  {
    name: "allows error reporting inside a non-aborted branch",
    rule: reactRouterGuardAbortedHandleError,
    source:
      "export function handleError(error, { request }) { if (!request.signal.aborted) { console.error(error); } }",
    ...REACT_ROUTER_FRAMEWORK_SERVER_ENTRY_OPTIONS,
  },
  {
    name: "allows unrelated object methods named logError",
    rule: reactRouterGuardAbortedHandleError,
    source:
      "const analytics = { logError() {} }; export function handleError(error, { request }) { analytics.logError(error); }",
    ...REACT_ROUTER_FRAMEWORK_SERVER_ENTRY_OPTIONS,
  },
  {
    name: "ignores handleError exports outside the server entry",
    rule: reactRouterGuardAbortedHandleError,
    source: "export function handleError(error, { request }) { console.error(error); }",
    filename: "/project/app/routes/dashboard.tsx",
  },
  {
    name: "allows loader fetches that forward request.signal",
    rule: reactRouterLoaderFetchForwardsSignal,
    source:
      'export async function loader({ request }) { return fetch("/api/profile", { signal: request.signal }); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows an aliased loader request signal",
    rule: reactRouterLoaderFetchForwardsSignal,
    source:
      'export async function loader({ request: routeRequest }) { return fetch("/api/profile", { signal: routeRequest.signal }); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows a local request signal alias",
    rule: reactRouterLoaderFetchForwardsSignal,
    source:
      'export async function loader({ request }) { const signal = request.signal; return fetch("/api/profile", { signal }); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows a request signal destructuring alias",
    rule: reactRouterLoaderFetchForwardsSignal,
    source:
      'export async function loader({ request }) { const { signal } = request; return fetch("/api/profile", { signal }); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows request signals through TypeScript wrappers",
    rule: reactRouterLoaderFetchForwardsSignal,
    source:
      'export async function loader({ request }) { await fetch("/direct", { signal: request!.signal! }); return fetch(request!); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows a wrapped route argument request signal",
    rule: reactRouterLoaderFetchForwardsSignal,
    source:
      'export async function loader(args) { return fetch("/member", { signal: args!.request.signal satisfies AbortSignal }); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows loader options through a shadowed undefined binding",
    rule: reactRouterLoaderFetchForwardsSignal,
    source:
      'export async function loader({ request }) { const undefined = { signal: request.signal }; return fetch("/api/profile", undefined); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows dependent loader awaits",
    rule: reactRouterLoaderParallelFetch,
    source:
      "export async function loader() { const user = await getUser(); const teams = await getTeams(user.id); return { user, teams }; }",
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows redirect outside a catch",
    rule: reactRouterNoRedirectInTryCatch,
    source:
      'import { redirect } from "react-router"; export async function loader() { const user = await getUser(); if (!user) return redirect("/login"); return user; }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows returned redirects inside try-catch",
    rule: reactRouterNoRedirectInTryCatch,
    source:
      'import { redirect } from "react-router"; export async function loader() { try { return redirect("/login"); } catch (error) { return null; } }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows a deferred router factory",
    rule: reactRouterNoRouterInRender,
    source:
      'import { createMemoryRouter } from "react-router"; export const makeTestRouter = () => createMemoryRouter([]);',
  },
  {
    name: "allows mutually exclusive middleware continuations",
    rule: reactRouterNoMultipleMiddlewareNext,
    source:
      "export const middleware = [async ({ admin }, next) => { if (admin) return next(); return next(); }];",
  },
  {
    name: "allows mutually exclusive middleware continuations in a conditional expression",
    rule: reactRouterNoMultipleMiddlewareNext,
    source: "export const middleware = [async ({ enabled }, next) => enabled ? next() : next()];",
  },
  {
    name: "allows passing middleware continuation to helpers",
    rule: reactRouterNoMultipleMiddlewareNext,
    source:
      "export const middleware = [async (_context, next) => { observe(next); observe(next); return new Response(); }];",
  },
  {
    name: "does not infer a response from a passed middleware continuation",
    rule: reactRouterNoMiddlewareResponseBodyConsumption,
    source:
      "export const middleware = [async (_context, next) => { const response = await observe(next); await response.json(); return response; }];",
  },
  {
    name: "allows passing a response body-reader method to a helper",
    rule: reactRouterNoMiddlewareResponseBodyConsumption,
    source:
      "export const middleware = [async (_context, next) => { const response = await next(); observe(response.json); return response; }];",
  },
  {
    name: "allows passing a loader session mutator method to a helper",
    rule: reactRouterNoSessionMutationInLoader,
    source:
      'import { createCookieSessionStorage } from "react-router"; const { getSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function loader({ request }) { const session = await getSession(request.headers.get("Cookie")); observe(session.set); return null; }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows mutually exclusive search param updates",
    rule: reactRouterNoMultipleSetSearchParamsInTick,
    source:
      'import { useSearchParams } from "react-router"; export function Filters({ compact }) { const [, setParams] = useSearchParams(); if (compact) setParams({ view: "compact" }); else setParams({ view: "full" }); return null; }',
  },
  {
    name: "allows mutually exclusive search param updates in a conditional expression",
    rule: reactRouterNoMultipleSetSearchParamsInTick,
    source:
      'import { useSearchParams } from "react-router"; export function Filters({ compact }) { const [, setParams] = useSearchParams(); compact ? setParams({ view: "compact" }) : setParams({ view: "full" }); return null; }',
  },
  {
    name: "allows search param updates separated by await",
    rule: reactRouterNoMultipleSetSearchParamsInTick,
    source:
      'import { useSearchParams } from "react-router"; export function Filters() { const [, setParams] = useSearchParams(); const update = async () => { setParams({ phase: "start" }); await save(); setParams({ phase: "done" }); }; return <button onClick={update} />; }',
  },
  {
    name: "allows search param updates separated by an early return",
    rule: reactRouterNoMultipleSetSearchParamsInTick,
    source:
      'import { useSearchParams } from "react-router"; export function Filters({ compact }) { const [, setParams] = useSearchParams(); if (compact) { setParams({ view: "compact" }); return null; } setParams({ view: "full" }); return null; }',
  },
  {
    name: "allows a middleware catch with another throwing operation",
    rule: reactRouterNoCatchMiddlewareNext,
    source:
      "export const middleware = [async (_context, next) => { try { validate(); return await next(); } catch (error) { report(error); } }];",
  },
  {
    name: "allows middleware to return a replacement response after next",
    rule: reactRouterServerMiddlewareReturnResponse,
    source:
      'export const middleware = [async (_context, next) => { await next(); return new Response("replacement"); }];',
  },
  {
    name: "allows middleware to return a bound next response",
    rule: reactRouterServerMiddlewareReturnResponse,
    source:
      "export const middleware = [async (_context, next) => { const response = await next(); return response; }];",
  },
  {
    name: "allows unique route IDs",
    rule: reactRouterNoDuplicateRouteId,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ id: "root", path: "/" }, { id: "settings", path: "/settings" }]);',
  },
  {
    name: "allows absolute children under their complete parent path",
    rule: reactRouterNoInvalidAbsoluteChildPath,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/app", children: [{ path: "/app/settings", element: <Settings /> }] }]);',
  },
  {
    name: "allows nested absolute parents without duplicating their path",
    rule: reactRouterNoInvalidAbsoluteChildPath,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/app", children: [{ path: "/app/settings", children: [{ path: "/app/settings/profile", element: <Profile /> }] }] }]);',
  },
  {
    name: "allows absolute children beneath a parameterized parent",
    rule: reactRouterNoInvalidAbsoluteChildPath,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/users/:userId", children: [{ path: "/users/settings", element: <Settings /> }] }]);',
  },
  {
    name: "allows absolute children beneath an optional parent",
    rule: reactRouterNoInvalidAbsoluteChildPath,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/users/:userId?", children: [{ path: "/users/settings", element: <Settings /> }] }]);',
  },
  {
    name: "allows absolute children beneath a splat parent",
    rule: reactRouterNoInvalidAbsoluteChildPath,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/files/*", children: [{ path: "/files/preview", element: <Preview /> }] }]);',
  },
  {
    name: "allows a root boundary supplied by lazy",
    rule: reactRouterRequireRootErrorBoundary,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", lazy: () => import("./root") }]);',
  },
  {
    name: "allows minimal routers in testing directories",
    rule: reactRouterRequireRootErrorBoundary,
    source:
      'import { createMemoryRouter } from "react-router"; export const makeRouter = () => createMemoryRouter([{ path: "/", element: <Page /> }]);',
    filename: "/project/src/testing/test-utils.tsx",
  },
  {
    name: "allows valid non-index route objects",
    rule: reactRouterValidRouteObject,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", Component: Root, children: [{ index: true, Component: Home }] }]);',
  },
  {
    name: "allows committed action session mutations",
    rule: reactRouterSessionMutationRequiresCommit,
    source:
      'import { createCookieSessionStorage } from "react-router"; const { getSession, commitSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); return redirect("/", { headers: { "Set-Cookie": await commitSession(session) } }); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows action session mutations committed on every return path",
    rule: reactRouterSessionMutationRequiresCommit,
    source:
      'import { createCookieSessionStorage } from "react-router"; const { getSession, commitSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request, redirectHome }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); if (redirectHome) return redirect("/", { headers: { "Set-Cookie": await commitSession(session) } }); return redirect("/profile", { headers: { "Set-Cookie": await commitSession(session) } }); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows a destroyed action session returned as Set-Cookie",
    rule: reactRouterSessionMutationRequiresCommit,
    source:
      'import { createCookieSessionStorage } from "react-router"; const { getSession, destroySession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); return redirect("/", { headers: { "Set-Cookie": await destroySession(session) } }); }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows reading a session mutator property without calling it",
    rule: reactRouterSessionMutationRequiresCommit,
    source:
      'import { createCookieSessionStorage } from "react-router"; const { getSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); observe(session.set); return null; }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "ignores session mutations inside a nested helper",
    rule: reactRouterSessionMutationRequiresCommit,
    source:
      'import { createCookieSessionStorage } from "react-router"; const { getSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); const updateLater = () => session.set("user", "a"); return null; }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "ignores statically unreachable session mutations",
    rule: reactRouterSessionMutationRequiresCommit,
    source:
      'import { createCookieSessionStorage } from "react-router"; const { getSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); if (false) session.set("user", "a"); return null; }',
    ...REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
  },
  {
    name: "allows the same CSP nonce on router and stream",
    rule: reactRouterCspNonceConsistency,
    source:
      'import { ServerRouter } from "react-router"; import { renderToPipeableStream } from "react-dom/server"; export const render = (request, context, nonce) => renderToPipeableStream(<ServerRouter context={context} url={request.url} nonce={nonce} />, { nonce });',
  },
  {
    name: "allows the same member-expression CSP nonce",
    rule: reactRouterCspNonceConsistency,
    source:
      'import { ServerRouter } from "react-router"; import { renderToPipeableStream } from "react-dom/server"; export const render = (request, context) => renderToPipeableStream(<ServerRouter context={context} url={request.url} nonce={context.nonce} />, { nonce: context.nonce });',
  },
  {
    name: "allows the same string CSP nonce",
    rule: reactRouterCspNonceConsistency,
    source:
      'import { ServerRouter } from "react-router"; import { renderToPipeableStream } from "react-dom/server"; export const render = (request, context) => renderToPipeableStream(<ServerRouter context={context} url={request.url} nonce="fixed" />, { nonce: "fixed" });',
  },
  {
    name: "allows modules whose ordinary name starts with client",
    rule: reactRouterNoClientModuleInServerRender,
    source:
      'import { ClientCard } from "./client-card"; export default function Route() { return <ClientCard />; }',
  },
  {
    name: "allows client modules in the client entry",
    rule: reactRouterNoClientModuleInServerRender,
    source:
      'import { ClientCard } from "./card.client"; export const hydrate = () => <ClientCard />;',
    filename: "/project/app/entry.client.tsx",
  },
  {
    name: "allows client modules inside another client-only module",
    rule: reactRouterNoClientModuleInServerRender,
    source:
      'import { ClientCard } from "./card.client"; export const ClientShell = () => <ClientCard />;',
    filename: "/project/app/components/shell.client.tsx",
  },
  {
    name: "allows client modules inside an imported ClientOnly render prop",
    rule: reactRouterNoClientModuleInServerRender,
    source:
      'import { ClientOnly } from "./client-only"; import { ClientCard } from "./card.client"; export default function Route() { return <ClientOnly>{() => <ClientCard />}</ClientOnly>; }',
  },
  {
    name: "allows synchronized search params mutation",
    rule: reactRouterNoUnsynchronizedSearchParamsMutation,
    source:
      'import { useSearchParams } from "react-router"; export function Filters() { const [params, setParams] = useSearchParams(); return <button onClick={() => { params.set("tab", "all"); setParams(params); }} />; }',
  },
  {
    name: "allows synchronized search params mutation through an immutable alias",
    rule: reactRouterNoUnsynchronizedSearchParamsMutation,
    source:
      'import { useSearchParams } from "react-router"; export function Filters() { const [searchParams, setSearchParams] = useSearchParams(); const params = searchParams; return <button onClick={() => { params.set("tab", "all"); setSearchParams(params); }} />; }',
  },
  {
    name: "allows search params mutation synchronized after an inline iterator",
    rule: reactRouterNoUnsynchronizedSearchParamsMutation,
    source:
      'import { useSearchParams } from "react-router"; import { useEffect } from "react"; export function Filters() { const [params, setParams] = useSearchParams(); useEffect(() => { ["page"].forEach((key) => params.delete(key)); setParams(params); }, [params, setParams]); }',
  },
  {
    name: "allows search params mutation synchronized with a different setter value",
    rule: reactRouterNoUnsynchronizedSearchParamsMutation,
    source:
      'import { useSearchParams } from "react-router"; export function Filters() { const [params, setParams] = useSearchParams(); return <button onClick={() => { params.delete("page"); setParams(""); }} />; }',
  },
  {
    name: "allows serialized search params returned for navigation",
    rule: reactRouterNoUnsynchronizedSearchParamsMutation,
    source:
      'import { useSearchParams } from "react-router"; export function Filters() { const [params] = useSearchParams(); const href = () => { params.set("page", "2"); return `/items?${params.toString()}`; }; return <a href={href()}>Next</a>; }',
  },
  {
    name: "allows serialized search params passed to useNavigate",
    rule: reactRouterNoUnsynchronizedSearchParamsMutation,
    source:
      'import { useNavigate, useSearchParams } from "react-router"; export function useNext() { const navigate = useNavigate(); const [params] = useSearchParams(); return () => { ["page"].forEach((key) => params.set(key, "2")); navigate(`/items?${params.toString()}`); }; }',
  },
  {
    name: "allows a known UI anchor with a non-self target",
    rule: reactRouterInternalRouteAnchor,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/report", element: <Report /> }]); export const Download = () => <a href="/report" target="report-frame">Report</a>;',
  },
  {
    name: "allows an anchor to a route with explicitly falsy UI properties",
    rule: reactRouterInternalRouteAnchor,
    source:
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/component", Component: null }, { path: "/element", element: false }, { path: "/lazy", lazy: undefined }]); export const Navigation = () => <><a href="/component">Component</a><a href="/element">Element</a><a href="/lazy">Lazy</a></>;',
  },
  {
    name: "allows a resource link with a dynamic target",
    rule: reactRouterResourceLinkRequiresReload,
    source:
      'import { Link } from "react-router"; export const Download = ({ target }) => <Link to="/report.pdf" target={target}>Report</Link>;',
  },
  {
    name: "allows an ordinary imported route component",
    rule: reactRouterPreferRouteLazy,
    source:
      'import { createBrowserRouter } from "react-router"; import Page from "./page"; createBrowserRouter([{ path: "/", Component: Page }]);',
  },
  {
    name: "allows ordinary route module filenames",
    rule: reactRouterNoRouteModuleEnvironmentSuffix,
    source: "export default function Route() { return null; }",
    filename: "/project/app/routes/dashboard.tsx",
  },
  {
    name: "ignores a shadowed Date constructor in cookie options",
    rule: reactRouterNoStaticCookieExpires,
    source:
      'import { createCookie } from "react-router"; const Date = class {}; export const cookie = createCookie("prefs", { expires: new Date(dynamicValue) });',
  },
  {
    name: "allows helper modules with environment suffixes",
    rule: reactRouterNoRouteModuleEnvironmentSuffix,
    source: "export const formatDate = (value) => String(value);",
    filename: "/project/app/routes/utils.server.ts",
  },
  {
    name: "allows default-exported helpers whose basename starts with routes",
    rule: reactRouterNoRouteModuleEnvironmentSuffix,
    source: "export default function buildRoutes() { return []; }",
    filename: "/project/app/routes-helper.server.ts",
  },
  {
    name: "allows default-exported environment helpers colocated in route folders",
    rule: reactRouterNoRouteModuleEnvironmentSuffix,
    source: "export default function ClientWidget() { return null; }",
    filename: "/project/app/routes/dashboard/client-widget.client.tsx",
  },
  {
    name: "allows a transition callback that returns navigation",
    rule: reactRouterReturnNavigationPromiseInTransition,
    source:
      'import { startTransition } from "react"; import { RouterProvider, useNavigate } from "react-router"; export const App = ({ router }) => <RouterProvider router={router} useTransitions />; export const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => navigate("/next"))} />; };',
    settings: { "react-doctor": { capabilities: ["react-router:7.15"] } },
  },
  {
    name: "allows discarded navigation when transitions are explicitly disabled",
    rule: reactRouterReturnNavigationPromiseInTransition,
    source:
      'import { startTransition } from "react"; import { RouterProvider, useNavigate } from "react-router"; export const App = ({ router }) => <RouterProvider router={router} useTransitions={false} />; export const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => { void navigate("/next"); })} />; };',
    settings: { "react-doctor": { capabilities: ["react-router:7.15"] } },
  },
  {
    name: "allows discarded navigation when unstable transitions are explicitly disabled",
    rule: reactRouterReturnNavigationPromiseInTransition,
    source:
      'import { startTransition } from "react"; import { RouterProvider, useNavigate } from "react-router"; export const App = ({ router }) => <RouterProvider router={router} unstable_useTransitions={false} />; export const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => { void navigate("/next"); })} />; };',
  },
  {
    name: "allows passing navigate to a helper inside a transition",
    rule: reactRouterReturnNavigationPromiseInTransition,
    source:
      'import { startTransition } from "react"; import { RouterProvider, useNavigate } from "react-router"; export const App = ({ router }) => <RouterProvider router={router} useTransitions />; export const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => schedule(navigate))} />; };',
    settings: { "react-doctor": { capabilities: ["react-router:7.15"] } },
  },
];

describe("React Router rule regressions", () => {
  for (const safeCase of safeRuleCases) {
    it(safeCase.name, () => {
      const result = runRule(safeCase.rule, safeCase.source, {
        ...(safeCase.filename === undefined ? {} : { filename: safeCase.filename }),
        ...(safeCase.settings === undefined ? {} : { settings: safeCase.settings }),
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  }

  it("reports useLoaderData in a Framework root Layout", () => {
    const result = runRule(
      reactRouterNoUseLoaderDataInErrorUi,
      'import { useLoaderData } from "react-router"; export function Layout() { const data = useLoaderData(); return <html>{data}</html>; }',
      {
        filename: "/project/app/root.tsx",
        settings: {
          "react-doctor": { capabilities: ["react-router-framework"] },
        },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports loader fetches with nullish options", () => {
    const result = runRule(
      reactRouterLoaderFetchForwardsSignal,
      'export async function loader({ request }) { await fetch("/null", null); await fetch("/undefined", undefined); return fetch("/void", void 0); }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports every uncovered top-level route branch", () => {
    const result = runRule(
      reactRouterRequireRootErrorBoundary,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", ErrorBoundary: RootError }, { path: "/admin", element: <Admin /> }, { path: "/account", lazy: () => import("./account") }]);',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports explicitly falsy root error boundaries", () => {
    const result = runRule(
      reactRouterRequireRootErrorBoundary,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", ErrorBoundary: null }, { path: "/admin", errorElement: undefined }, { path: "/account", lazy: false }]);',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("recognizes inline data-router loader properties without framework mode", () => {
    const result = runRule(
      reactRouterNoLoaderRequestBody,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", loader: async ({ request }) => request.formData() }]);',
      { settings: { "react-doctor": { capabilities: ["react-router:6.4"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a setter in another handler hide a search-param mutation", () => {
    const result = runRule(
      reactRouterNoUnsynchronizedSearchParamsMutation,
      'import { useSearchParams } from "react-router"; export function Filters() { const [params, setParams] = useSearchParams(); const mutate = () => params.set("tab", "all"); const synchronize = () => setParams(params); return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports navigate in an immediately invoked render callback", () => {
    const result = runRule(
      reactRouterNoNavigateInRender,
      'import { useNavigate } from "react-router"; export function App() { const navigate = useNavigate(); (() => navigate("/next"))(); return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports navigate in a synchronous iterator during render", () => {
    const result = runRule(
      reactRouterNoNavigateInRender,
      'import { useNavigate } from "react-router"; export function App() { const navigate = useNavigate(); routes.forEach((route) => navigate(route)); return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports navigate in a React transition started during render", () => {
    const result = runRule(
      reactRouterNoNavigateInRender,
      'import { startTransition } from "react"; import { useNavigate } from "react-router"; export function App() { const navigate = useNavigate(); startTransition(() => navigate("/next")); return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports navigate through a local helper chain invoked during render", () => {
    const result = runRule(
      reactRouterNoNavigateInRender,
      'import { useNavigate } from "react-router"; export function App() { const navigate = useNavigate(); const go = () => navigate("/next"); const run = () => go(); run(); return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a local navigate helper passed to a render-time transition", () => {
    const result = runRule(
      reactRouterNoNavigateInRender,
      'import { startTransition } from "react"; import { useNavigate } from "react-router"; export function App() { const navigate = useNavigate(); const go = () => navigate("/next"); startTransition(go); return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows navigate through local helpers invoked after render", () => {
    const result = runRule(
      reactRouterNoNavigateInRender,
      'import { useNavigate } from "react-router"; export function App() { const navigate = useNavigate(); const go = () => navigate("/next"); return <button onClick={() => go()}>Next</button>; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("allows a transition-like callback that is not the React API", () => {
    const result = runRule(
      reactRouterNoNavigateInRender,
      'import { useNavigate } from "react-router"; export function App() { const navigate = useNavigate(); const startTransition = queueTask; startTransition(() => navigate("/next")); return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a resource NavLink without reloadDocument", () => {
    const result = runRule(
      reactRouterResourceLinkRequiresReload,
      'import { createBrowserRouter, NavLink as ResourceLink } from "react-router"; createBrowserRouter([{ path: "/guide.pdf", loader: loadGuide }]); export const Download = () => <ResourceLink to="/guide.pdf">Guide</ResourceLink>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes resource NavLinks imported from react-router/dom", () => {
    const result = runRule(
      reactRouterResourceLinkRequiresReload,
      'import { createBrowserRouter } from "react-router"; import { NavLink } from "react-router/dom"; createBrowserRouter([{ path: "/guide.pdf", loader: loadGuide }]); export const Download = () => <NavLink to="/guide.pdf">Guide</NavLink>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports statically known resource destinations with falsy reload props", () => {
    const result = runRule(
      reactRouterResourceLinkRequiresReload,
      'import { createBrowserRouter, Link } from "react-router"; createBrowserRouter([{ path: ("/guide.pdf" as const), loader: loadGuide }]); export const Downloads = () => <><Link to={"/guide.pdf"} reloadDocument={false}>Reload</Link><Link to={`/guide.pdf`} download={false}>Download</Link></>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps potentially enabled resource-link escape props conservative", () => {
    const result = runRule(
      reactRouterResourceLinkRequiresReload,
      'import { createBrowserRouter, Link } from "react-router"; createBrowserRouter([{ path: "/guide.pdf", loader: loadGuide }]); export const Downloads = ({ shouldDownload, shouldReload }) => <><Link to={"/guide.pdf"} reloadDocument={shouldReload}>Reload</Link><Link to={`/guide.pdf`} download={shouldDownload}>Download</Link></>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports duplicate route IDs through transparent TypeScript wrappers", () => {
    const result = runRule(
      reactRouterNoDuplicateRouteId,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ id: ("dashboard" as const), path: "/" }, { id: ("dashboard" satisfies string), path: "/settings" }]);',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports static expression anchors when download is falsy", () => {
    const result = runRule(
      reactRouterInternalRouteAnchor,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/about", element: <About /> }]); export const Navigation = () => <><a href={"/about"} download={false}>About</a><a href={`/about`} download={null}>About</a></>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps potentially enabled anchor downloads conservative", () => {
    const result = runRule(
      reactRouterInternalRouteAnchor,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/about", element: <About /> }]); export const Navigation = ({ shouldDownload }) => <a href={"/about"} download={shouldDownload}>About</a>;',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not accept a shadowed useOutlet as a nested route render point", () => {
    const result = runRule(
      reactRouterNestedRouteRequiresOutlet,
      'import { createBrowserRouter, useOutlet } from "react-router"; createBrowserRouter([{ Component: () => { const useOutlet = () => null; return <main>{useOutlet()}</main>; }, children: [{ path: "child", element: <Child /> }] }]);',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not accept an Outlet rendered only by a nested helper", () => {
    const result = runRule(
      reactRouterNestedRouteRequiresOutlet,
      'import { createBrowserRouter, Outlet } from "react-router"; createBrowserRouter([{ Component: () => { const Unused = () => <Outlet />; return <main />; }, children: [{ path: "child", element: <Child /> }] }]);',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports forbidden lazy properties from nested and later returns", () => {
    const result = runRule(
      reactRouterNoInvalidLazyRouteProperties,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", lazy: async () => { if (compact) { return { id: "compact" }; } return { path: "/changed" }; } }]);',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports forbidden lazy properties through TypeScript wrappers", () => {
    const result = runRule(
      reactRouterNoInvalidLazyRouteProperties,
      'import { createBrowserRouter } from "react-router"; createBrowserRouter([{ path: "/", lazy: async () => ({ path: "/changed" } as const) }, { path: "/other", lazy: async () => { return ({ id: "changed" } satisfies { id: string }); } }]);',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores descendant routes declared only by a nested helper", () => {
    const result = runRule(
      reactRouterDescendantRoutesRequireSplat,
      'import { createBrowserRouter, Routes } from "react-router"; createBrowserRouter([{ path: "/dashboard", Component: () => { const Unused = () => <Routes />; return <main />; } }]);',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports two direct middleware continuation calls", () => {
    const result = runRule(
      reactRouterNoMultipleMiddlewareNext,
      "export const middleware = [async (_context, next) => { await next(); return next(); }];",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports two middleware continuation calls inside one branch", () => {
    const result = runRule(
      reactRouterNoMultipleMiddlewareNext,
      "export const middleware = [async ({ admin }, next) => { if (admin) { await next(); return next(); } return new Response(); }];",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports consuming a response returned by middleware continuation", () => {
    const result = runRule(
      reactRouterNoMiddlewareResponseBodyConsumption,
      "export const middleware = [async (_context, next) => { const response = await next(); await response.json(); return response; }];",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a bound middleware response that is never returned", () => {
    const result = runRule(
      reactRouterServerMiddlewareReturnResponse,
      "export const middleware = [async (_context, next) => { const response = await next(); response.headers.set('x-trace', '1'); }];",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a middleware response returned on only one later path", () => {
    const result = runRule(
      reactRouterServerMiddlewareReturnResponse,
      "export const middleware = [async ({ includeResponse }, next) => { const response = await next(); if (includeResponse) return response; }];",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a dropped navigation promise inside a transition", () => {
    const result = runRule(
      reactRouterReturnNavigationPromiseInTransition,
      'import { startTransition } from "react"; import { RouterProvider, useNavigate } from "react-router"; export const App = ({ router }) => <RouterProvider router={router} useTransitions />; export const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => { navigate("/next"); })} />; };',
      { settings: { "react-doctor": { capabilities: ["react-router:7.15"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an explicitly discarded navigation promise inside a transition", () => {
    const result = runRule(
      reactRouterReturnNavigationPromiseInTransition,
      'import { startTransition } from "react"; import { RouterProvider, useNavigate } from "react-router"; export const App = ({ router }) => <RouterProvider router={router} useTransitions />; export const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => { void navigate("/next"); })} />; };',
      { settings: { "react-doctor": { capabilities: ["react-router:7.15"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports search param updates in one sequence expression", () => {
    const result = runRule(
      reactRouterNoMultipleSetSearchParamsInTick,
      'import { useSearchParams } from "react-router"; export function Filters() { const [, setParams] = useSearchParams(); const update = () => { (setParams({ page: "1" }), setParams({ sort: "name" })); }; return <button onClick={update} />; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports nested search param updates in one statement", () => {
    const result = runRule(
      reactRouterNoMultipleSetSearchParamsInTick,
      'import { useSearchParams } from "react-router"; export function Filters() { const [, setParams] = useSearchParams(); const update = () => { setParams(setParams({ page: "1" })); }; return <button onClick={update} />; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a later search param update inside a nested block", () => {
    const result = runRule(
      reactRouterNoMultipleSetSearchParamsInTick,
      'import { useSearchParams } from "react-router"; export function Filters({ compact }) { const [, setParams] = useSearchParams(); setParams({ page: "1" }); if (compact) { setParams({ view: "compact" }); } return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a string CSP nonce passed only to ServerRouter", () => {
    const result = runRule(
      reactRouterCspNonceConsistency,
      'import { ServerRouter } from "react-router"; import { renderToPipeableStream } from "react-dom/server"; export const render = (request, context) => renderToPipeableStream(<ServerRouter context={context} url={request.url} nonce="fixed" />, {});',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("abstains when transition-enabled and disabled routers share a file", () => {
    const result = runRule(
      reactRouterReturnNavigationPromiseInTransition,
      'import { startTransition } from "react"; import { RouterProvider, useNavigate } from "react-router"; export const App = ({ router, fallbackRouter }) => <><RouterProvider router={router} useTransitions /><RouterProvider router={fallbackRouter} /></>; export const Button = () => { const navigate = useNavigate(); return <button onClick={() => startTransition(() => { navigate("/next"); })} />; };',
      { settings: { "react-doctor": { capabilities: ["react-router:7.15"] } } },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports a loader session mutator invocation", () => {
    const result = runRule(
      reactRouterNoSessionMutationInLoader,
      'import { createCookieSessionStorage } from "react-router"; const { getSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function loader({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("notice", "hello"); return null; }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a file-backed loader session mutator invocation", () => {
    const result = runRule(
      reactRouterNoSessionMutationInLoader,
      'import { createFileSessionStorage } from "@react-router/node"; const { getSession } = createFileSessionStorage({ dir: "./sessions", cookie: { name: "session" } }); export async function loader({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("notice", "hello"); return null; }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a loader that destroys its session", () => {
    const result = runRule(
      reactRouterNoSessionMutationInLoader,
      'import { createCookieSessionStorage } from "react-router"; const { getSession, destroySession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function loader({ request }) { const session = await getSession(request.headers.get("Cookie")); return redirect("/", { headers: { "Set-Cookie": await destroySession(session) } }); }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a static expiry in file-backed session options", () => {
    const result = runRule(
      reactRouterNoStaticCookieExpires,
      'import { createFileSessionStorage } from "@react-router/node"; export const sessions = createFileSessionStorage({ dir: "./sessions", cookie: { name: "session", expires: new Date(Date.now() + 1000) } });',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a static expiry inside merged cookie options", () => {
    const result = runRule(
      reactRouterNoStaticCookieExpires,
      'import { createCookie } from "react-router"; export const cookie = createCookie("session", merge({ sameSite: "lax" }, { expires: new Date(Date.now() + 1000) }));',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an unsynchronized search params mutation through an immutable alias", () => {
    const result = runRule(
      reactRouterNoUnsynchronizedSearchParamsMutation,
      'import { useSearchParams } from "react-router"; export function Filters() { const [searchParams] = useSearchParams(); const params = searchParams; params.set("tab", "all"); return null; }',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an abort check that occurs after error reporting", () => {
    const result = runRule(
      reactRouterGuardAbortedHandleError,
      "export function handleError(error, { request }) { console.error(error); if (request.signal.aborted) return; }",
      REACT_ROUTER_FRAMEWORK_SERVER_ENTRY_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an imported namespace error reporter without an abort guard", () => {
    const result = runRule(
      reactRouterGuardAbortedHandleError,
      'import * as Sentry from "@sentry/node"; export function handleError(error, { request }) { Sentry.captureException(error); }',
      REACT_ROUTER_FRAMEWORK_SERVER_ENTRY_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a session mutator invocation without a commit", () => {
    const result = runRule(
      reactRouterSessionMutationRequiresCommit,
      'import { createCookieSessionStorage } from "react-router"; const { getSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); return null; }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a discarded destroyed-session cookie", () => {
    const result = runRule(
      reactRouterSessionMutationRequiresCommit,
      'import { createCookieSessionStorage } from "react-router"; const { getSession, destroySession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); await destroySession(session); return redirect("/"); }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a file-backed session mutator invocation without a commit", () => {
    const result = runRule(
      reactRouterSessionMutationRequiresCommit,
      'import { createFileSessionStorage } from "@react-router/node"; const { getSession } = createFileSessionStorage({ dir: "./sessions", cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); return null; }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a session mutation when only one return path commits", () => {
    const result = runRule(
      reactRouterSessionMutationRequiresCommit,
      'import { createCookieSessionStorage } from "react-router"; const { getSession, commitSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request, shouldCommit }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); if (shouldCommit) return redirect("/", { headers: { "Set-Cookie": await commitSession(session) } }); return null; }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a session mutation that occurs after the last commit", () => {
    const result = runRule(
      reactRouterSessionMutationRequiresCommit,
      'import { createCookieSessionStorage } from "react-router"; const { getSession, commitSession } = createCookieSessionStorage({ cookie: { name: "session" } }); export async function action({ request }) { const session = await getSession(request.headers.get("Cookie")); session.set("user", "a"); await commitSession(session); session.set("notice", "hello"); return null; }',
      REACT_ROUTER_FRAMEWORK_ROUTE_OPTIONS,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
