# React Router rule research

Research date: 2026-07-19

Status: implemented and validated on the accompanying branch.

## Outcome

React Router is a strong candidate for a dedicated React Doctor family, but it cannot be treated as
one framework-shaped API. Its official agent skill separates Framework, Data, and Declarative
modes, and the same distinction is necessary for sound linting. In particular, loaders, actions,
fetchers, `route.lazy`, and route-module exports do not exist in Declarative mode.

The first pass found 15 candidates. A second pass through the router runtime invariants, middleware
implementation, v6/v7/v8 changelogs, security advisories, Framework conventions, accepted design
decisions, and maintainer threads expands the backlog to 38 candidates. The P0 tier is now 12 rules
whose harmful behavior is directly provable and whose version boundary can be encoded; the table
retains the original P1/P2 context:

| Priority | Candidate                                               | Modes                | Precision       | Confidence                    |
| -------- | ------------------------------------------------------- | -------------------- | --------------- | ----------------------------- |
| P0       | `react-router-no-router-in-render`                      | Data                 | scope + path    | high                          |
| P0       | `react-router-no-navigate-in-render`                    | all                  | path            | high                          |
| P0       | `react-router-no-unsynchronized-search-params-mutation` | all                  | scope + path    | high                          |
| P0       | `react-router-no-multiple-set-search-params-in-tick`    | all                  | path            | high                          |
| P0       | `react-router-no-invalid-lazy-route-properties`         | Data                 | scope           | high                          |
| P0       | `react-router-nested-route-requires-outlet`             | all                  | cross-file      | high when resolved            |
| P0       | `react-router-no-loader-request-body`                   | Framework, Data      | scope           | high                          |
| P0       | `react-router-no-session-mutation-in-loader`            | Framework            | scope           | high                          |
| P0       | `react-router-no-use-loader-data-in-error-ui`           | Framework, Data      | scope + project | high                          |
| P0       | `react-router-no-multiple-middleware-next`              | Framework, Data      | path            | high                          |
| P0       | `react-router-descendant-routes-require-splat`          | all                  | cross-file      | high when resolved            |
| P0       | `react-router-no-invalid-absolute-child-path`           | all                  | project         | high when static              |
| P1       | `react-router-require-root-error-boundary`              | Framework, Data      | project         | high                          |
| P1       | `react-router-guard-aborted-handle-error`               | Framework            | path            | high                          |
| P1       | `react-router-resource-link-requires-reload`            | Framework, Data      | project + scope | high when resolved            |
| P1       | `react-router-loader-parallel-fetch`                    | Framework, Data      | path            | high                          |
| P1       | `react-router-loader-fetch-forwards-signal`             | Data, client loaders | scope           | medium-high                   |
| P1       | `react-router-prefer-route-lazy`                        | Data                 | scope           | medium-high                   |
| P2       | `react-router-internal-route-anchor`                    | all                  | project + scope | medium-high when resolved     |
| P2       | `react-router-csp-nonce-consistency`                    | Framework            | cross-file      | medium-high                   |
| P2       | `react-router-valid-route-object`                       | Data                 | scope           | high, but mostly type-covered |

The number is intentionally not the goal. The expansion is useful because it separates three
different products that should not be conflated:

- default-on behavioral rules with direct runtime or security consequences;
- version-scoped migration rules that only activate for a declared target major;
- dependency/configuration diagnostics better implemented in the existing supply-chain or project
  scanners than as AST lint rules.

“When resolved” is load-bearing. The project-aware rules should remain silent when React Doctor
cannot prove the route target or component implementation. A missing diagnostic is preferable to
guessing that an anchor points to a UI route, that an imported component omits an outlet, or that a
URL is a resource route.

## Implementation status

All 38 source diagnostics in this document are registered. Project discovery resolves
`@react-router/dev`, `react-router-dom`, and `react-router`, emits monotonic capabilities at each
release boundary used by a rule, distinguishes Framework mode from non-Framework package use, and
chooses the lowest parseable version in a mixed-version workspace. An unparseable workspace or
catalog spec receives only the bare `react-router` capability, so version-specific rules fail
closed. Data- and Declarative-mode rules require local syntax proof from imported APIs instead of a
project-wide mode guess. Every rule also checks the nearest package boundary before creating
visitors.

The implementation deliberately constrains cross-file contracts to same-file static evidence:
inline route objects, inline component bodies, literal destinations, proven imports, and recognized
Framework entry/config filenames. It does not guess through opaque route factories, imported
components, dynamic options, or arbitrary helper calls. Dependency advisories remain in the
existing supply-chain scanner instead of being duplicated as AST rules.

Validation covered the plugin's full regression suite, strict invariant fuzzing, a 100-repository
cross-framework corpus, a React Router 6.30 SPA, a 7.0 Data-mode app, a 7.16 Framework app, the
official stable-middleware playground, and the official v8 template. The field pass narrowed two
detectors before release: loader parallelization now requires independent native `fetch` calls,
and environment-suffixed route modules require a default route component rather than any colocated
named export.

## Required foundation

### Mode-aware capability detection

The shipped foundation uses project capabilities only where package evidence is reliable:

- `react-router`: `react-router` or `react-router-dom` is installed.
- `react-router-framework`: `@react-router/dev` is installed.
- monotonic version tokens: `react-router:6.4` through `react-router:8` at the release boundaries
  used by the rules.

The official skill provides the exact mode signals and warns not to apply Framework/Data guidance
to Declarative apps. Data and Declarative usage are therefore proven locally from route creators,
route objects, JSX routers, and imported APIs. Filename-sensitive Framework rules stay limited to
canonical files; resolving custom `appDirectory` and arbitrary route configs remains future
cross-file-index work.

Source compatibility matters:

- React Router 6 applications commonly import DOM APIs from `react-router-dom`.
- React Router 7 collapsed the APIs into `react-router` and `react-router/dom` while retaining the
  compatibility package.
- React Router 8 removed `react-router-dom`.

Rules should resolve imports from both packages, then use the installed major only where behavior
actually differs. The current documentation is v8.2.0, while the contracts below intentionally
target stable Data APIs from v6.4 onward and Framework APIs from v7 onward.

### Version resolver and rule gates

Version-aware does not mean checking the import spelling. The shipped resolver reads declared
versions and catalog references from root and workspace manifests, chooses the lowest parseable
version conservatively, and treats an unresolved or non-semver dependency as unknown. A rule may
then choose one of four policies:

1. **API-presence gate:** activate from the first version that shipped the API.
2. **Behavior gate:** activate only from the release that made the diagnosed behavior true.
3. **Target-major migration gate:** activate only when the user explicitly targets the next major,
   or when the installed major has already removed the construct.
4. **Advisory gate:** compare the installed package to a patched range in the supply-chain scanner;
   do not pretend a vulnerable dependency is a source-code lint problem.

| Feature or behavior                    | v6                                 | v7                                                              | v8                            | Rule consequence                                                                                                                     |
| -------------------------------------- | ---------------------------------- | --------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Data routers, loaders, actions         | `>=6.4`                            | supported                                                       | supported                     | Data-only rules require Data/Framework proof, not merely a package import.                                                           |
| `route.lazy` function                  | `>=6.9`                            | supported; object form added later                              | supported                     | Lazy-property and route-lazy rules stay off below 6.9.                                                                               |
| `useBlocker`                           | unstable `>=6.7`, stable `>=6.19`  | supported                                                       | supported                     | Multiple-blocker rule recognizes both names only in their valid ranges.                                                              |
| Search-param setter callback isolation | shared mutable instance before 7.7 | copied callback value from `7.7.0`                              | copied value                  | The mutation rule follows only the tuple result, never the setter callback parameter, so the same detector is valid across versions. |
| Middleware                             | absent                             | unstable before 7.9; stable `>=7.9`                             | always enabled                | Stable middleware rules gate at 7.9; experimental middleware remains outside the first shipped contract.                             |
| `next()` never throws                  | absent                             | true from `7.8.0`                                               | true                          | The try/catch-around-`next` rule must stay off for older experimental middleware.                                                    |
| React transition router option         | absent                             | `unstable_useTransitions` from 7.10; `useTransitions` from 7.15 | supported as `useTransitions` | Promise-return rule uses the correct prop name and only treats Data/Framework navigation APIs as promise-returning.                  |
| Framework root `Layout` error flow     | absent                             | supported                                                       | supported                     | Loader-data-in-error-UI applies to Framework root `Layout` and route boundaries from v7.                                             |
| Package entry points                   | `react-router-dom` normal          | compatibility export retained                                   | `react-router-dom` removed    | The import migration rule activates only for an installed v8; maintained v6/v7 apps remain quiet.                                    |
| `meta`/`useMatches` match data         | `data`                             | `data` deprecated from 7.8; `loaderData` available              | `data` removed                | The removed-field rule activates only for an installed v8 and requires scope or Framework-export proof.                              |
| `future.v8_*` flags                    | absent                             | opt-in upgrade controls                                         | removed or promoted           | The removed-flag rule activates only for an installed v8 Framework config.                                                           |

Two important non-rules follow from this matrix:

- Do not run a v8 codemod-style diagnostic merely because current documentation prefers the v8
  spelling. A maintained v6 application is correct to import from `react-router-dom`.
- Do not fork every behavioral detector by major. Most route-tree invariants are unchanged from
  v6 through v8; attach a minimum version only when the API or behavior genuinely differs.

### Route and component index

Three candidates need a small cross-file index:

- route parent -> component/module;
- route path -> UI route or resource route;
- component -> directly or transitively renders `Outlet`/calls `useOutlet`.

Framework mode can derive this from `routes.ts`, `@react-router/fs-routes`, and the configured app
directory. Data mode can derive it from static route objects supplied to a data-router creator.
Declarative mode can derive it from `Route` elements. Dynamic route factories, runtime patching,
and opaque third-party configs stay unknown.

## Evidence base

### Primary React Router sources

- The [official React Router agent skill](https://github.com/remix-run/react-router/blob/main/.agents/skills/react-router/SKILL.md)
  defines the mode boundary and says to use installed, version-matched docs. It was added to
  `create-react-router` in v8.1.0.
- [Picking a Mode](https://reactrouter.com/start/modes) explains that Data mode moves route config
  outside React rendering and adds loaders/actions/fetchers on top of Declarative mode.
- [Data-mode installation](https://reactrouter.com/start/data/installation) says to create a data
  router once outside the React tree and not hold it in React state.
- [RouterProvider](https://reactrouter.com/api/data-routers/RouterProvider) explicitly warns against
  creating new routers during renders and re-renders.
- [useSearchParams](https://reactrouter.com/api/hooks/useSearchParams) documents both the stable,
  mutable object and the lack of React-style queueing for repeated setter calls in one tick.
- The [`route.lazy` design decision](https://github.com/remix-run/react-router/blob/main/decisions/0002-lazy-route-modules.md)
  explains why path-matching fields cannot be returned by `lazy` and why static handlers can run in
  parallel with lazy module loading.
- [Data routing](https://reactrouter.com/start/data/routing) states that child routes render through
  the parent `Outlet` and that index routes cannot have children.
- [Error boundaries](https://reactrouter.com/how-to/error-boundary) says every application should
  export at least a root error boundary and documents boundary bubbling.
- [`entry.server.tsx`](https://reactrouter.com/api/framework-conventions/entry.server.tsx) says
  aborted requests generally should not be logged or reported from `handleError`.
- [Resource routes](https://reactrouter.com/how-to/resource-routes) require an anchor or
  `Link reloadDocument`; an ordinary `Link` makes the router try to render the payload as UI.
- [Custom Data frameworks](https://reactrouter.com/start/data/custom) demonstrate forwarding
  `request.signal` to a loader fetch.
- [Security](https://reactrouter.com/how-to/security) requires the same CSP nonce on
  `ServerRouter` and the React streaming renderer.
- [Middleware](https://reactrouter.com/how-to/middleware) says `next()` may be called only once,
  never throws from v7.8 onward, and requires the server middleware to return the response.
- [Sessions and Cookies](https://reactrouter.com/explanation/sessions-and-cookies) warns that
  session mutation in a loader creates CSRF exposure, explains the required outgoing
  `commitSession`/`destroySession` cookie, and recommends `maxAge` over a module-static expiry.
- [Root route convention](https://reactrouter.com/api/framework-conventions/root.tsx) forbids
  `useLoaderData` in `ErrorBoundary` and extends the restriction to root `Layout`, which also
  renders error flows.
- [Client modules](https://reactrouter.com/api/framework-conventions/client-modules) says exports
  from `.client` modules are `undefined` on the server and should only be consumed in effects and
  user-event callbacks.
- [Server modules](https://reactrouter.com/api/framework-conventions/server-modules) says route
  modules cannot use `.server` or `.client` suffixes because the compiler needs them in both
  graphs.
- [React Transitions](https://reactrouter.com/explanation/react-transitions) requires returning or
  awaiting an imperative navigation promise inside `startTransition`.
- The accepted [Do not clone request decision](https://github.com/remix-run/react-router/blob/main/decisions/0002-do-not-clone-request.md)
  defines loaders as GET/HEAD handlers with no request body.
- Runtime route conversion and matching enforce unique route IDs, valid absolute-child prefixes,
  index routes without children, splats after `/`, one router, and one blocker.
- [Updating from v7](https://reactrouter.com/upgrading/v7) and the
  [changelog](https://reactrouter.com/home/changelog) provide the v8 import, `loaderData`, future
  flag, runtime baseline, and security-patch boundaries used by the version matrix.

### Maintainer issues, pull requests, and discussions

- [Discussion #10605](https://github.com/remix-run/react-router/discussions/10605) diagnoses duplicate
  loaders under Strict Mode when `createBrowserRouter` runs in a component render and directs the
  user to module scope.
- [Issue #11622](https://github.com/remix-run/react-router/issues/11622) led to the official warning
  that the stable `searchParams` reference is mutable and can diverge from the URL.
- [Issues #14491](https://github.com/remix-run/react-router/issues/14491) and
  [#14077](https://github.com/remix-run/react-router/issues/14077) confirm that repeated
  `setSearchParams` calls in one tick intentionally do not compose like React state updates.
- [PR #10435](https://github.com/remix-run/react-router/pull/10435) fixed Strict Mode behavior for
  `Navigate` in a data router. It is evidence not to ban `Navigate`; descendant `Routes` in a Data
  app still do not participate in loaders and may need the component.
- [Discussion #10465](https://github.com/remix-run/react-router/discussions/10465) recommends
  `route.lazy` over `React.lazy` for a data route because the latter introduces a render-fetch
  waterfall.
- [Remix issue #5846](https://github.com/remix-run/remix/issues/5846) contains a concrete nested
  route that never renders because its parent omits `Outlet`.
- [PR #12601](https://github.com/remix-run/react-router/pull/12601) added the nuanced
  `clientLoader.hydrate`/`HydrateFallback` documentation; this evidence rules out an unconditional
  “hydrate requires fallback” rule.
- [Discussion #9841](https://github.com/remix-run/react-router/discussions/9841) and the router's
  own warning demonstrate that a component-owned descendant `Routes` tree requires the parent path
  to end in `/*`.
- [PR #14118](https://github.com/remix-run/react-router/pull/14118) changed middleware error
  handling in v7.8 so `next()` returns a boundary response instead of throwing.
- [PR #14215](https://github.com/remix-run/react-router/pull/14215) stabilized middleware and
  context APIs in v7.9.
- [PR #14524](https://github.com/remix-run/react-router/pull/14524) introduced transition-enabled
  routers in v7.10, and [PR #14999](https://github.com/remix-run/react-router/pull/14999) stabilized
  the `useTransitions` spelling in v7.15.
- The accepted [useBlocker decision](https://github.com/remix-run/react-router/blob/main/decisions/0001-use-blocker.md)
  explicitly limits a router to one active blocker.

### Skills and ecosystem review

- The official skill is mode- and version-aware. Its strongest lintable guidance is represented in
  this backlog: router creation outside render, loader/action data flow, outlet nesting, route lazy
  loading, URL parsing, and root error handling.
- The community
  [frontend React Router best-practices skill](https://github.com/sergiodxa/agent-skills/blob/main/skills/frontend-react-router-best-practices/SKILL.md)
  supplied useful seeds around parallel loaders, abort signals, resource routes, forms/fetchers,
  redirects, and hydration. Its organizational and preference-level advice was not treated as a
  rule contract without primary corroboration.
- The old `eslint-plugin-react-router` package predates modern data routers. Putout offers React
  Router transforms, and TanStack Router has a router-specific ESLint plugin, but there is no
  mature modern React Router lint suite covering these contracts. React Doctor would be filling a
  real gap rather than cloning an established ruleset.

## P0 contracts

### `react-router-no-router-in-render`

Rule definition:
This rule catches a data-router instance created inside a component or hook render lifecycle and
passed to `RouterProvider`, which recreates router state and can rerun loaders.

Runtime reason:
A data router owns navigation, loader, fetcher, and subscription state. Recreating it during React
render discards that state; Strict Mode can create it twice and execute initial loaders twice.

Detector precision:
Scope-aware plus render-path analysis.

Evidence:

- Data installation and `RouterProvider` require one instance outside the React tree.
- Discussion #10605 reproduces duplicate loaders and the maintainer identifies render-time router
  construction as the cause.

Strong positives:

- `const router = createBrowserRouter(routes)` directly in `App`, returned through
  `<RouterProvider router={router} />`.
- A router held in `useState` or `useMemo` and passed to `RouterProvider`; the official docs reject
  React-owned router lifetime, not just the direct-call spelling.
- Aliased imports of `createBrowserRouter`, `createHashRouter`, or `createMemoryRouter`.

False-positive traps:

- Module-scope router construction is correct.
- `createStaticRouter` per server request is correct and is not part of this rule.
- A factory mentioned inside a component but only executed by an unrelated deferred callback and
  never supplied to `RouterProvider` should stay quiet.
- Test helpers may intentionally create isolated memory routers; either exclude test-like files or
  tag the rule for test noise.

In scope:

- Proven React Router creator imports whose result reaches the provider in the same file.
- Direct calls and React initializer callbacks.

Out of scope:

- Opaque custom router factories, cross-file value flow, and server static routers in v1.

Test seeds:

- Invalid: direct render call, aliased creator, `useMemo`, `useState` initializer, helper invoked on
  the render path.
- Valid: module scope, server request `createStaticRouter`, unused deferred callback, shadowed local
  `createBrowserRouter`.

Open questions:

- Whether test files should be excluded or reported under `test-noise`.

### `react-router-no-navigate-in-render`

Rule definition:
This rule catches the function returned by `useNavigate` being invoked on the synchronous render
path, which causes navigation as a render side effect.

Runtime reason:
Render can restart or execute more than once. A navigation there can duplicate loader work,
produce hydration inconsistencies, or trigger update-during-render failures.

Detector precision:
Scope-aware path analysis.

Evidence:

- `useNavigate` is documented for user interactions or effects.
- Discussion #10605 recommends links or loader redirects instead of navigation from render.

Strong positives:

- `if (!user) navigate("/login")` in a component body.
- A local helper called synchronously from render that invokes the proven navigate binding.
- Calls inside an IIFE, array iterator, or `startTransition` executed during render.

False-positive traps:

- Event handlers, effects, promise continuations, timers, and callbacks returned from custom hooks.
- `<Navigate>` is a separate supported API and must not be flagged.
- A locally declared or shadowed function named `navigate`.

In scope:

- Named, aliased, and namespace imports of `useNavigate` from supported React Router packages.
- Direct and transitively invoked local synchronous functions.

Out of scope:

- Opaque imported helpers and deciding whether an effect should be converted to a loader redirect.

Test seeds:

- Invalid: direct conditional call, IIFE, called helper, `forEach`, `startTransition`.
- Valid: click handler, effect, timeout, `.then`, returned hook callback, shadowed hook/function.

Open questions:

- None. Reuse the hardened deferred-callback analysis from
  `tanstack-start-no-navigate-in-render`.

### `react-router-no-unsynchronized-search-params-mutation`

Rule definition:
This rule catches mutation of the `URLSearchParams` object returned by `useSearchParams` when the
same synchronous update does not call its paired setter, leaving the object and URL out of sync.

Runtime reason:
The hook returns a stable but mutable reference. Mutating it can change values observed on a later
render even though the browser URL never changed.

Detector precision:
Scope-aware path analysis.

Evidence:

- The current hook documentation states the exact object/URL divergence.
- Issue #11622 records the maintainer clarification that became the documentation.

Strong positives:

- `searchParams.set`, `append`, `delete`, or `sort` on the first tuple binding with no paired
  `setSearchParams` call in the same synchronous update.
- Mutation through a local alias of the proven hook result.

False-positive traps:

- Mutating the callback parameter inside `setSearchParams(previous => { ...; return previous })`
  is an official supported example.
- `const next = new URLSearchParams(searchParams); next.set(...)` is valid.
- Mutating the outer object and then passing it to the paired setter in the same path updates the
  URL and should stay quiet, even if cloning is stylistically cleaner.
- An unrelated `URLSearchParams` instance or shadowed `useSearchParams`.

In scope:

- Direct mutating methods on the proven first tuple element and simple local aliases.
- Pairing with the second tuple element from the same hook call.

Out of scope:

- Mutation hidden in imported helpers or passed through arbitrary object graphs.

Test seeds:

- Invalid: each mutator without setter, alias mutation, mutation in a later event callback without
  setter.
- Valid: setter callback mutation, clone mutation, mutation followed by paired setter, read-only
  methods, shadowed hook.

Open questions:

- Whether mutation followed by the setter only on some control-flow branches should report at the
  mutation or at the unpaired exit.

### `react-router-no-multiple-set-search-params-in-tick`

Rule definition:
This rule catches two reachable calls to the same `setSearchParams` binding in one synchronous
execution segment, where later navigation overwrites rather than composes with the earlier update.

Runtime reason:
Unlike React state, functional search-param updates are not queued. Multiple calls in the same tick
start from the same location and do not build on one another.

Detector precision:
Path-aware.

Evidence:

- The behavior is an explicit warning in the hook documentation.
- Issues #14491 and #14077 were closed as expected behavior and point users to one combined update
  or intermediate React state.

Strong positives:

- Two setter calls in sequence in one event/effect/function.
- A setter call followed by a synchronously invoked local helper that calls the same binding.

False-positive traps:

- Calls in mutually exclusive branches.
- A later call after `await`, in a timer, or in a promise continuation.
- Calls to setters from different `useSearchParams` instances.
- A deliberately redundant first call is dead but not necessarily a router correctness issue; v1
  may still report because its result is provably discarded, with a precise message rather than a
  claim about user intent.

In scope:

- Same-file direct calls and synchronously invoked local helpers.
- One diagnostic on the later call.

Out of scope:

- Cross-module helper effects and scheduling through unknown APIs.

Test seeds:

- Invalid: sequential object updates, sequential functional updates, called local helper.
- Valid: combined callback, exclusive branches, post-`await`, timeout, different setters.

Open questions:

- Whether to begin with direct same-function calls only, then add local helper expansion after OSS
  evaluation.

### `react-router-no-invalid-lazy-route-properties`

Rule definition:
This rule catches a Data route's `lazy` result attempting to define `path`, `index`,
`caseSensitive`, `children`, or `id`, which React Router cannot apply after matching.

Runtime reason:
React Router must match and uniquely identify a route before it knows which `lazy` function to
load. Returning matching fields is too late and is ignored with a warning.

Detector precision:
Scope-aware.

Evidence:

- The route-lazy design decision names the immutable fields and explains the ordering constraint.
- `createBrowserRouter` documentation keeps route definitions such as path/index available up
  front while lazily loading implementation fields.

Strong positives:

- A route object passed to a data-router creator whose inline `lazy` function returns any forbidden
  field.
- A `lazy: () => import(...)` module that can be resolved locally and exports one of the forbidden
  route fields.

False-positive traps:

- An arbitrary object with a property named `lazy`.
- Valid lazy fields such as `Component`, `ErrorBoundary`, `loader`, `action`, `handle`, and
  `shouldRevalidate`.
- Static route fields beside `lazy` are correct.

In scope:

- Inline object returns first; locally resolvable imported route modules as a follow-up.

Out of scope:

- Dynamic imports whose exports cannot be statically resolved.

Test seeds:

- Invalid: each forbidden field, async return, aliased data-router creator.
- Valid: forbidden fields on the static route object, valid implementation fields from lazy,
  unrelated `lazy` object, shadowed creator.

Open questions:

- None for inline returns.

### `react-router-nested-route-requires-outlet`

Rule definition:
This rule catches a route that both renders a parent component and owns child routes when the
resolved parent component never renders `Outlet` and never calls `useOutlet`.

Runtime reason:
Matched child UI is inserted only at the parent's outlet. Without one, the URL can match while the
child is never visible.

Detector precision:
Project-aware cross-file resolution.

Evidence:

- Data routing documents the outlet as the child render point.
- Remix issue #5846 demonstrates a matched nested route hidden by a parent without an outlet.

Strong positives:

- A Data route object with `Component` plus `children`, where the local component tree contains no
  outlet.
- A declarative parent `Route element={<Layout />}>` with nested `Route` children and a resolvable
  outlet-free layout.
- A Framework route module used as a parent in `routes.ts` with no transitive outlet.

False-positive traps:

- A prefix route with children but no component needs no outlet.
- A component that delegates to a local/imported child which renders `Outlet` is valid.
- `useOutlet()` rendered as a value is valid.
- An opaque external component must remain unknown and quiet.

In scope:

- Statically indexed routes and components, with transitive local component traversal.

Out of scope:

- Runtime-patched routes, arbitrary route factories, and unresolved external layouts.

Test seeds:

- Invalid: local parent without outlet in all three modes, fragment-only layout, unrelated imported
  symbol named Outlet.
- Valid: direct Outlet, aliased Outlet, `useOutlet`, delegated local child, prefix route, leaf route,
  unresolved external component.

Open questions:

- Set a conservative traversal depth and cycle handling policy for delegated component trees.

## P1 contracts

### `react-router-require-root-error-boundary`

Rule definition:
This rule catches a Framework or Data application whose statically known root route coverage has no
React Router error boundary.

Runtime reason:
Without an application boundary, unexpected loader, action, lazy-module, and render errors fall to
the minimal built-in UI instead of an application-owned recovery surface.

Detector precision:
Project-aware.

Evidence:

- The error-boundary guide says every application should at minimum export a root boundary and
  shows both Framework and Data forms.

Strong positives:

- Framework `root.*` without named `ErrorBoundary` export.
- A Data router with a single root route lacking `ErrorBoundary`/`errorElement`.
- Multiple top-level Data branches where at least one branch has no ancestor boundary covering it.

False-positive traps:

- Nested routes do not each need a boundary; errors bubble to the nearest ancestor.
- Declarative `Routes` do not participate in data-router error handling.
- A custom Framework app directory must be honored.

In scope:

- Framework root modules and static Data route trees.

Out of scope:

- Runtime-patched route trees and generic React class error boundaries not registered with the
  router.

Test seeds:

- Invalid: Framework root without export, Data root without either boundary form, uncovered second
  root branch.
- Valid: named Framework export, Data `ErrorBoundary`, Data `errorElement`, nested routes covered by
  an ancestor, Declarative app.

Open questions:

- Whether the first release should support only Framework mode for a simpler, zero-ambiguity
  project check.

### `react-router-guard-aborted-handle-error`

Rule definition:
This rule catches known logging or error-reporting sinks in Framework `handleError` that are not
dominated by a `request.signal.aborted` guard.

Runtime reason:
React Router aborts interrupted requests as normal concurrency behavior. Reporting those requests
creates false incidents and noisy logs.

Detector precision:
Path-aware.

Evidence:

- The `entry.server` contract explicitly recommends skipping aborted requests and provides the
  guard.

Strong positives:

- Unconditional `console.error`, Sentry `captureException`, or a known logger/reporting import in
  exported `handleError`.
- Reporting in a branch that can still execute when `request.signal.aborted` is true.

False-positive traps:

- `if (request.signal.aborted) return` before the sink.
- `if (!request.signal.aborted) { report(error) }`.
- Pure formatting, metrics explicitly describing abort volume, and an unrelated function named
  `handleError` outside the server entry/module contract.

In scope:

- Framework server entry files and typed/named `handleError` exports; global `console.error` and
  Sentry reporting imports. Nested function bodies are excluded unless execution is proven.

Out of scope:

- Unknown side-effect functions whose reporting semantics cannot be established.

Test seeds:

- Invalid: unguarded console, Sentry, logger import, partial guard.
- Valid: positive guard, early return, no sink, client `onError`, shadowed request/signal.

Open questions:

- Curate the initial reporting-sink imports from existing React Doctor telemetry knowledge rather
  than guessing from function names alone.

### `react-router-resource-link-requires-reload`

Rule definition:
This rule catches `Link` or `NavLink` client navigation to a statically known resource route without
`reloadDocument`.

Runtime reason:
A resource route returns a file or raw response, not route UI. Client routing tries to fetch and
render that payload through the data-router protocol and fails.

Detector precision:
Project-aware plus scope resolution.

Evidence:

- The resource-route guide explicitly requires `<a>` or `<Link reloadDocument>`.
- PR #8283 introduced the intentional full-document escape hatch.

Strong positives:

- A literal or statically generated `to` that resolves to a route module with loader/action but no
  default component.
- A Data route object target with a loader/action and no render property.

False-positive traps:

- Native anchors are correct for resource routes.
- `reloadDocument`, external URLs, unresolved dynamic targets, and UI routes.
- A path-only parent route with children is not a resource route.

In scope:

- Exact static targets proven by a loader/action-only Data route object in the same module. This
  conservative first release requires React Router 6.4 or newer.

Out of scope:

- Cross-file Framework route discovery, parameterized targets, runtime-generated routes, and
  arbitrary string construction. These require a project route index before they can be enabled
  without reviving the file-extension false positive.

Test seeds:

- Invalid: Link/NavLink to static and parameterized resource paths.
- Valid: native anchor, reloadDocument, UI route, external URL, unresolved target, shadowed Link.

Open questions:

- Whether Data-mode resource classification should require the loader to return a proven
  `Response`, reducing coverage but avoiding component-less prefix routes.

### `react-router-loader-parallel-fetch`

Rule definition:
This rule catches independent sequential awaits in a route loader or client loader that create an
avoidable request waterfall.

Runtime reason:
Route rendering waits for loader completion. Independent work serialized by separate awaits adds
latencies instead of taking their maximum.

Detector precision:
Path-aware dependency analysis.

Evidence:

- Route object documentation demonstrates `Promise.all` inside lazy loading, and React Router runs
  matched loaders in parallel.
- The official and community skills recommend parallel independent loader work.

Strong positives:

- Two or more pairwise-independent top-level awaits in a Framework `loader`/`clientLoader`.
- Independent awaits in a loader property of a proven Data route.

False-positive traps:

- The second operation consumes data, or a transitively derived binding, from the first.
- Sequential mutation/transaction semantics.
- Nested callbacks that are already scheduled concurrently.

In scope:

- Reuse and generalize the dependency-aware implementation in
  `tanstack-start-loader-parallel-fetch` rather than fork it.

Out of scope:

- Imported helper internals and performance claims about a single await.

Test seeds:

- Invalid: independent fetches, aliased route exports, three awaits with an independent sibling
  pair.
- Valid: direct/transitive dependency, control-flow alternatives, `Promise.all`, non-loader.

Open questions:

- Prefer a shared `loader-parallel-fetch` detector with framework-specific entry recognizers over a
  copy of the TanStack rule.

### `react-router-loader-fetch-forwards-signal`

Rule definition:
This rule catches a direct `fetch` in a Data loader or browser-executed client loader that receives
the route `request` but does not forward its abort signal.

Runtime reason:
React Router cancels interrupted navigations. Without `request.signal`, the underlying request
continues consuming network/server resources after its result is no longer usable.

Detector precision:
Scope-aware.

Evidence:

- The custom Data framework guide's loader fetch explicitly uses `{ signal: request.signal }`.
- React Router's race-condition model and server request APIs propagate abortable Fetch Requests.

Strong positives:

- `fetch(url)` or `fetch(url, { ...options })` in a proven loader that destructures/receives
  `request` but omits its signal.
- Aliased request parameters and namespace/global fetch.

False-positive traps:

- `fetch(request)` already carries the request signal.
- `fetch(new Request(url, { signal: request.signal }))` and composed option objects proven to carry
  it.
- Server-only database calls are not fetch.
- Fire-and-forget mutations have different cancellation semantics; v1 should target loaders and
  client loaders, not actions.

In scope:

- Direct native fetch and statically inspectable options.

Out of scope:

- Axios/custom clients, opaque wrappers, actions, and cases where no route request parameter is
  available.

Test seeds:

- Invalid: missing second arg, options without signal, unrelated signal.
- Valid: request signal, `fetch(request)`, Request wrapper, database call, action, custom client.

Open questions:

- Whether Framework server loaders should be included immediately or only where the downstream
  fetch is known to honor AbortSignal.

### `react-router-prefer-route-lazy`

Rule definition:
This rule catches a Data route component supplied through a binding created by `React.lazy` when
the route could load its implementation with `route.lazy` before render.

Runtime reason:
`React.lazy` begins loading at render time, after route matching/data work, creating a render-fetch
waterfall. `route.lazy` lets the router load route implementation before rendering and coordinate it
with data work.

Detector precision:
Scope-aware.

Evidence:

- Maintainer guidance in discussion #10465 explicitly recommends `route.lazy` for this reason.
- The route-lazy design and official examples load route implementation fields together.

Strong positives:

- A `React.lazy` binding used as `Component`/`element` in a static route object passed to a data
  router.
- The equivalent JSX route produced by `createRoutesFromElements` and passed to a data router.

False-positive traps:

- Declarative `Routes` cannot use data-router route lazy; `React.lazy` is valid there.
- A lazy component nested inside a route component is not itself the route implementation.
- Framework mode already performs route-module code splitting and should not receive Data-mode
  rewrite advice.

In scope:

- Proven React `lazy` bindings used directly as Data route render fields.

Out of scope:

- Custom lazy wrappers and deciding whether a small route is worth splitting.

Test seeds:

- Invalid: Component and element forms, aliases, createRoutesFromElements feeding a data router.
- Valid: Declarative Route, nested lazy child, Framework route module, ordinary component, shadowed
  lazy.

Open questions:

- Confirm the diagnostic can offer a safe non-autofix migration shape for both default and named
  module exports.

## P2 and conditional candidates

### `react-router-internal-route-anchor`

Only report a literal/static native anchor when the route index proves it targets a UI route.
Exclude resource routes, external/protocol-relative URLs, downloads, `_blank`, same-document hashes,
and explicit full-reload conventions. The existing TanStack anchor rule has useful syntax handling,
but a React Router version without route-target proof would false-positive on the exact native
anchor required for resource routes.

### `react-router-csp-nonce-consistency`

When a Framework server entry creates or receives a CSP nonce, require the same value to reach both
`ServerRouter nonce` and the `nonce` option of `renderToPipeableStream` or
`renderToReadableStream`. Do not require nonce props merely because `Scripts` or
`ScrollRestoration` exists; a project without nonce-based CSP is valid, and current Framework mode
inherits the `ServerRouter` nonce for those components. Pair each render call with the single
`ServerRouter` in its render argument, and treat immutable identifier aliases as the same nonce.

### `react-router-valid-route-object`

For proven Data route objects, catch API contradictions that JavaScript users otherwise encounter
at runtime: an index route with `children`, `element` with `Component`, `errorElement` with
`ErrorBoundary`, and `hydrateFallbackElement` with `HydrateFallback`. A path is valid on the
router's current `IndexRouteObject` and is not a contradiction. Keep this below the behavioral rules
because TypeScript already rejects most cases. `lazy` immutable fields remain a separate rule
because they are structurally valid objects whose values are ignored too late. Match the router's
truthiness semantics: explicit `undefined`, `null`, `false`, `0`, empty-string, and `void` values do
not create a contradiction.

## Additional high-confidence contracts

### `react-router-no-loader-request-body`

Rule definition:
Report body-consuming methods on the loader's proven `request` binding. React Router loaders are
GET/HEAD handlers; request parsing belongs in an action.

Runtime reason:
The accepted request decision removes the body before loaders run. Calls such as
`request.formData()` or `request.json()` cannot recover data that is not present and usually signal
that a mutation endpoint was placed in the wrong route API.

Detector precision:
Scope-aware. Start at v6.4 for Data mode and v7 for Framework route modules.

Strong positives:

- `request.formData()`, `json()`, `text()`, `blob()`, or `arrayBuffer()` on the destructured loader
  request.
- The same request binding passed to a local helper whose body immediately consumes it, when the
  existing cross-file probe can resolve that helper.

False-positive traps:

- Body reads in `action`, `clientAction`, a resource handler for a mutation method, custom server
  middleware, or an unrelated function named `loader`.
- `request.url`, headers, method, signal, or cloning for a non-body reason.
- A framework abstraction whose own `request` is not the React Router loader argument.

Implementation boundary:
No autofix. Moving code from a loader to an action changes the HTTP and UI contract.

### `react-router-no-session-mutation-in-loader`

Rule definition:
Report proven session writes in a Framework loader: `session.set`, `session.unset`,
`session.flash`, or a loader return that destroys the incoming session.

Security reason:
Loaders answer GET requests and can be triggered cross-site. React Router's session guide explicitly
warns that logout or any session mutation in a loader creates CSRF exposure.

Detector precision:
Scope-aware provenance from `getSession` or a known React Router session-storage factory. Framework
mode only by default.

Strong positives:

- A session obtained from `getSession(request.headers.get("Cookie"))` and mutated inside `loader`.
- `destroySession(session)` returned from a loader response.
- A loader helper that mutates the same resolved session object.

False-positive traps:

- `session.get`, `session.has`, auth checks, or redirecting an already-authenticated user.
- All mutation in actions.
- Reading a flash value. This can race across nested loaders, but reading is not the CSRF issue and
  should be a separate conditional diagnostic if pursued.
- A method named `set` on an unrelated object.

Implementation boundary:
No autofix. The safe repair generally adds a POST form/action and may affect progressive
enhancement.

### `react-router-no-use-loader-data-in-error-ui`

Rule definition:
Report `useLoaderData()` inside a proven route `ErrorBoundary` and inside the Framework root
`Layout`. Recommend `useRouteLoaderData(routeId)` or generated boundary props and require the
possibly-undefined result to be guarded.

Runtime reason:
The failing loader may be the operation that selected the boundary, so happy-path loader data may
not exist. Root `Layout` also renders `ErrorBoundary` children; if it throws while reading absent
data, React Router falls back to its minimal built-in boundary.

Detector precision:
Scope plus route-module/export proof. Framework v7+ and statically associated Data boundaries.

Strong positives:

- A named `ErrorBoundary` export calling an imported or aliased `useLoaderData`.
- A root `Layout` export calling it directly or through a local custom hook that resolves to it.
- An `errorElement={<Boundary />}` whose resolved component calls the hook.

False-positive traps:

- The normal route component, `HydrateFallback`, or a component merely named `ErrorBoundary` with
  no route association.
- `useRouteLoaderData("root")` followed by a guard.
- Loader data passed as an explicitly optional prop from a parent boundary.

Implementation boundary:
Do not offer a blind hook rename: the replacement needs a route ID and undefined handling.

### `react-router-no-multiple-middleware-next`

Rule definition:
Report a middleware function with two calls to its own `next` continuation that can execute on the
same path.

Runtime reason:
React Router throws `You may only call next() once per middleware` on the second call. `next` is a
single continuation through the remaining middleware and handler chain, not a reusable function.

Detector precision:
Scope-aware path analysis. Stable middleware from v7.9 and all v8; optionally recognize the
unstable v7 spelling only when its future flag is proven.

Strong positives:

- Two sequential `await next()` calls.
- One call before a branch and another on a reachable branch.
- Calling an alias of `next` and then `next` itself.

False-positive traps:

- Mutually exclusive branches where each complete path invokes `next` at most once.
- Nested callbacks that are never invoked by the middleware path.
- Two different middleware functions, each with its own continuation.
- An unrelated local function named `next`.

Implementation boundary:
No autofix. The second call may need deletion, or the middleware may need to reuse the first
`Response`.

### `react-router-no-catch-middleware-next`

Rule definition:
From v7.8 onward, report a try/catch whose protected operation is only `await next()` and whose
catch is intended to handle downstream route or middleware errors.

Runtime reason:
React Router catches downstream errors, renders the appropriate route boundary, and returns its
`Response` through `next()`. The catch is unreachable for those errors and creates a false sense of
recovery or logging coverage.

Detector precision:
Scope-aware syntax plus a hard behavior gate at v7.8. The narrow first version reports only when the
try body contains `await next()` with no other operation that can obviously throw.

Strong positives:

- `try { return await next() } catch (error) { report(error) }` in stable middleware.
- A catch that converts the supposed downstream error to a redirect or fallback response.

False-positive traps:

- Code in the try body before or after `next()` that can itself throw.
- Middleware versions before 7.8, where the experimental behavior differed.
- A catch around processing of the returned `Response`, such as parsing a header with an API that
  can throw.

Implementation boundary:
Recommend an `ErrorBoundary`, `handleError`, or instrumentation according to intent; no autofix.

### `react-router-descendant-routes-require-splat`

Rule definition:
When a route component itself renders a new descendant `<Routes>` tree or calls `useRoutes`, require
the route that mounts that component to end its static path with `/*`.

Runtime reason:
Without the trailing splat, the parent stops matching at its own path and deeper descendant URLs
never reach the nested route tree. React Router emits this exact runtime warning.

Detector precision:
Cross-file route/component resolution. Applies from v6 onward in every mode.

Strong positives:

- `<Route path="account" element={<AccountRoutes />} />` where `AccountRoutes` renders `<Routes>`.
- A Data route `path: "account"` whose resolved `Component` calls `useRoutes`.
- Transitive local wrappers when the route index can prove the descendant tree is rendered.

False-positive traps:

- Ordinary nested `<Route>` children rendered through `Outlet`; those do not require this rule.
- A component that renders `Outlet` but no new `Routes`/`useRoutes` tree.
- Dynamic paths or opaque third-party components that cannot be resolved.
- A leaf route that merely imports `Routes` for tests or types.

Implementation boundary:
A safe suggestion can show `path="account/*"`, but avoid autofix because route-relative links and
tests may need coordinated updates.

### `react-router-no-invalid-absolute-child-path`

Rule definition:
Report a static absolute child path that does not begin with the fully combined path of its static
parents.

Runtime reason:
React Router throws during route flattening because an absolute child cannot escape the path where
it is nested.

Detector precision:
Project-aware route-tree evaluation. Applies from v6 onward.

Strong positives:

- Parent `/app` with nested child `/settings`.
- A nested route-object factory whose resolved absolute path ignores a static ancestor segment.

False-positive traps:

- Valid parent `/app` with child `/app/settings`.
- Relative child `settings`.
- Optional parent segments, pathless layouts, dynamically patched routes, and helper-produced paths
  until the index models the router's own explode/flatten semantics exactly.
- Descendant `<Routes>` absolute-path limitations, which are related but are a separate contract.

Implementation boundary:
The first version should skip any ancestor containing optional or dynamic syntax it cannot normalize
with parity to the router implementation.

### `react-router-session-mutation-requires-commit`

Rule definition:
On each action exit path after a proven session mutation, require the resulting response to carry a
`Set-Cookie` value derived from `commitSession(session)`; after session destruction, require
`destroySession(session)` instead.

Runtime reason:
Session objects are in-memory request values. The mutation is not persisted until the serialized
cookie is included in the outgoing response.

Detector precision:
Scope-aware, path-sensitive provenance. Framework mode. Report only direct response construction
that the analyzer can follow.

Strong positives:

- `session.set(...)` followed by `return redirect("/")` with no headers.
- `destroySession(session)` is called but its result is ignored.
- One conditional return commits the session while another mutated path forgets it.

False-positive traps:

- A response helper whose resolved implementation adds the correct header.
- Database-backed session mutation still requires the cookie on create/delete, but existing-session
  updates may have custom semantics; remain quiet when the storage implementation is opaque.
- A session read with no mutation.
- Returning a `Response` supplied by middleware that centrally commits the session.

Implementation boundary:
No autofix. The first release follows direct `commitSession(session)` results and immutable local
bindings into a `Set-Cookie` property inside the returned expression. Response helpers, mutable
header objects, and cross-function propagation stay unknown. Header merging is application-specific
and an incorrect fix can drop existing headers.

### `react-router-return-navigation-promise-in-transition`

Rule definition:
In a transition-enabled router, report a Data/Framework imperative navigation or submission promise
called inside `startTransition` without being returned or awaited.

Runtime reason:
React ends the transition when the callback completes. Dropping the navigation promise ends pending
and optimistic transition state before the navigation finishes.

Detector precision:
Scope-aware callback control flow plus project configuration. Recognize
`unstable_useTransitions` in v7.10-v7.14, `useTransitions` from v7.15 onward, and current v8.
The first release reports only when the module contains exactly one proven `RouterProvider` and it
enables transitions; mixed-provider modules are ambiguous and must be skipped.

Strong positives:

- Block callback with a bare `navigate("/next")` statement.
- An async callback that invokes but does not await `navigate`, `submit`, `fetcher.load`, or
  `fetcher.submit`.
- A branch that returns the promise while another reachable branch drops it.

False-positive traps:

- Expression-bodied `() => navigate(...)`, which returns the promise.
- `return navigate(...)` or `await navigate(...)`.
- Declarative-mode `navigate` whose public return is `void`.
- A router without transition opt-in, unless a future v8 release makes the diagnosed behavior
  unconditional.
- An unrelated `navigate` or `submit` function.

Implementation boundary:
An autofix from a single bare expression to `return` is possible only when it cannot change
subsequent callback execution; otherwise suggest the repair.

### `react-router-no-client-module-in-server-render`

Rule definition:
In an SSR/prerendered Framework app, report values imported from `.client` files or `.client/`
directories when they are consumed during module initialization or component render.

Runtime reason:
React Router replaces client-module exports with `undefined` in the server graph. Render-time reads
can crash SSR or produce hydration-divergent markup.

Detector precision:
Import-path plus render-path analysis, gated to non-RSC Framework SSR/prerendering.

Strong positives:

- Calling an imported `.client` function in the component body.
- Reading a `.client` feature-detection constant to choose rendered markup.
- A module-scope call or property access on a client-only import.

False-positive traps:

- Consumption inside `useEffect`, a click/change/submit handler, `clientLoader`, or `clientAction`.
- Passing the function itself as a user-event handler without evaluating it during render.
- SPA mode with no server/prerender graph.
- RSC Framework mode, which uses `"use client"`/boundary packages instead of the conventional
  suffix semantics.

Implementation boundary:
No blind move-to-effect autofix; the correct server fallback is product-specific.

### `react-router-no-redirect-in-try-catch`

Rule definition:
Report `throw redirect(...)` or another proven thrown redirect response inside a try block when the
local catch can swallow or replace it. `return redirect(...)` remains valid and quiet.

Runtime reason:
A thrown redirect is control flow. A broad catch converts it into an error response, log, or
fallback, so the navigation never reaches React Router.

Detector precision:
Scope-aware thrown-value and catch-path analysis in loaders, actions, and middleware. Data v6.4+
and Framework v7+.

Strong positives:

- `try { throw redirect("/login") } catch { return data(...) }`.
- A helper call proven to throw a redirect inside a broad catch that never rethrows route responses.

False-positive traps:

- `return redirect(...)` in the try block.
- A catch that recognizes and rethrows the response before handling ordinary errors.
- Redirect construction outside the protected range.
- An unrelated function named `redirect`.

Reuse:
Generalize the existing Next.js and TanStack Start redirect-in-try-catch control-flow machinery;
only the redirect provenance and valid rethrow predicate should differ.

## Additional ranked backlog

These candidates have real evidence but either have a narrower payoff, are largely compiler-covered,
or need more project analysis before they should be default-on.

| Priority | Candidate                                              | Gate                                                                | Contract and boundary                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | `react-router-server-middleware-return-response`       | Framework server middleware, stable >=7.9 or proven unstable opt-in | If server middleware calls `next()`, every reachable completion must return that `Response` or an explicit replacement. Client middleware may omit it.                                                                                                                                             |
| P1       | `react-router-no-duplicate-route-id`                   | Data >=6.4                                                          | Report duplicate static explicit IDs across the resolved route tree. Generated, dynamic, and opaque IDs stay unknown. The router throws on collisions.                                                                                                                                             |
| P1       | `react-router-no-invalid-splat-path`                   | all, v6+                                                            | Report static patterns such as `files*`; React Router warns and interprets them as `files/*`. Exempt `*` and valid `/*`.                                                                                                                                                                           |
| P1       | `react-router-no-nested-router`                        | all, v6+                                                            | Report an obvious router provider rendered beneath another router in the same resolved tree. Start with direct JSX nesting; do not guess through opaque component composition.                                                                                                                     |
| P1       | `react-router-no-multiple-blockers`                    | Data >=6.7; stable name >=6.19                                      | Report two unconditional `useBlocker` calls in the same component/render path. The router supports one active blocker. Avoid whole-project counting because mutually exclusive routes are valid.                                                                                                   |
| P1       | `react-router-no-static-cookie-expires`                | Framework sessions                                                  | Report `expires: new Date(Date.now() + ...)` in module-scope cookie/session-storage options. The date is fixed once per deployment; recommend `maxAge`. Do not flag a literal intentional cutoff date.                                                                                             |
| P1       | `react-router-no-route-module-environment-suffix`      | non-RSC Framework v7+                                               | Report route files resolved from `routes.ts` whose filename/directory marks them `.server` or `.client`; the Framework build needs route modules in both graphs and fails.                                                                                                                         |
| P2       | `react-router-no-middleware-response-body-consumption` | server middleware >=7.9                                             | Warn when middleware consumes the `Response` returned by `next()` with `json`, `text`, `formData`, `blob`, or `arrayBuffer`. Header/status post-processing is supported; body consumption can make the outgoing body unusable. Keep conditional until runtime tests show zero legitimate patterns. |
| P2       | `react-router-no-empty-leaf-route`                     | static UI route tree, v6+                                           | Report a proven leaf UI route with no `element`, `Component`, or `lazy`; the router warns and renders a null outlet. Exclude resource routes, path prefixes, RSC routes, and intentionally componentless data routes.                                                                              |
| P2       | `react-router-v8-no-react-router-dom-import`           | installed v8                                                        | Replace DOM APIs with `react-router/dom` and other APIs with `react-router`. Never report this in v6 or v7.                                                                                                                                                                                        |
| P2       | `react-router-v8-no-meta-data-field`                   | installed v8                                                        | Report proven `data` bindings in `meta` args and `useMatches()` results; use `loaderData`. Scope proof is required because ordinary objects may have `data`.                                                                                                                                       |
| P2       | `react-router-v8-no-removed-future-flags`              | installed v8 Framework config                                       | Inspect only the default-exported config. Remove exact `future.v8_*` flags removed or promoted in v8 plus `unstable_previewServerPrerendering`; move `v8_splitRouteModules` to top-level `splitRouteModules`.                                                                                      |

### Non-AST project and dependency diagnostics

These findings belong in React Doctor's project/supply-chain passes, not the oxlint plugin:

| Diagnostic                                                                                                                                                                                                                                                                                                                           | Version boundary                                                                                                                       | Why it is not an AST rule                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| React Router v8 runtime compatibility                                                                                                                                                                                                                                                                                                | Node >=22.22, React/React DOM >=19.2.7, Framework Vite >=7, ESM-only consumers                                                         | Requires package-manager, engine, module-format, and workspace resolution.                    |
| React Router 7.12 [CSRF](https://github.com/remix-run/react-router/security/advisories/GHSA-h5cw-625j-3rxh), [redirect XSS](https://github.com/remix-run/react-router/security/advisories/GHSA-2w69-qvjg-hvjx), and [ScrollRestoration XSS](https://github.com/remix-run/react-router/security/advisories/GHSA-8v8x-cx79-35w7) fixes | `react-router >=7.0.0 <7.12.0` for CSRF; `>=7.0.0 <=7.11.0` for both XSS advisories. The advisories also name affected Remix packages. | Existing advisory/CVE infrastructure should own semver ranges and remediation.                |
| React Router 7.9.6 [external-redirect fix](https://github.com/remix-run/react-router/security/advisories/GHSA-9jcx-v3wj-wh4m)                                                                                                                                                                                                        | `react-router >=6.0.0 <=6.30.1` and `>=7.0.0 <=7.9.5`; the advisory also covers `@remix-run/router <=1.23.1`.                          | Dependency vulnerability, not a source pattern that can be made safe reliably.                |
| React Router 7.9.4 [file-session-storage fix](https://github.com/remix-run/react-router/security/advisories/GHSA-9583-h5hc-x8cw)                                                                                                                                                                                                     | `@react-router/node >=7.0.0 <=7.9.3`, plus affected Remix Node/Deno packages. Correlate with `createFileSessionStorage` use.           | Needs dependency and feature-use correlation; avoid a duplicate generic unsigned-cookie lint. |
| React Router 7.9.0 [meta XSS fix](https://github.com/remix-run/react-router/security/advisories/GHSA-3cgp-3xvw-98x8)                                                                                                                                                                                                                 | `react-router >=7.0.0 <=7.8.2`; the advisory also covers `@remix-run/react >=1.15.0 <=2.17.0`.                                         | A safe source rewrite is not equivalent to the upstream escaping fix.                         |
| React Router 7.5.2 [cache](https://github.com/remix-run/react-router/security/advisories/GHSA-f46r-rw29-r322)/[pre-render](https://github.com/remix-run/react-router/security/advisories/GHSA-cpj6-fhp6-mr6j) fixes                                                                                                                  | `react-router >=7.2.0 <=7.5.1` for forced-SPA cache poisoning and `>=7.0.0 <=7.5.1` for pre-render data spoofing.                      | These are server-runtime package flaws, not author mistakes.                                  |
| React Router Express 7.4.1 [host validation fix](https://github.com/remix-run/react-router/security/advisories/GHSA-4q56-crqp-v477)                                                                                                                                                                                                  | `@react-router/express 7.0.0-7.4.0`; the advisory also names affected `@remix-run/express` versions.                                   | Adapter dependency flaw, not a route source pattern.                                          |

These are the exact affected ranges returned by the repository's public GitHub security-advisory
records on the research date. The supply-chain implementation should ingest those canonical records
instead of maintaining a second hand-written range table; the rows above are review evidence, not a
new advisory database.

## Reuse and deduplication findings

| Proposed behavior                      | Existing code                                                                                | Decision                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Navigate render-path analysis          | `tanstack-start-no-navigate-in-render`                                                       | Extract/share the hardened detector.                                                                          |
| Independent loader awaits              | `tanstack-start-loader-parallel-fetch`                                                       | Generalize the recognizer; do not copy the dependency analysis.                                               |
| Thrown redirect inside catch           | `nextjs-no-redirect-in-try-catch` and `tanstack-start-redirect-in-try-catch`                 | Share catch/rethrow analysis; add React Router redirect provenance.                                           |
| Request-body consumption               | `request-body-mass-assignment` has body-parser provenance, but a different security purpose  | Reuse request-binding utilities only; do not broaden the mass-assignment rule.                                |
| Reachable duplicate continuation calls | existing path/reachability utilities used by state/effect rules                              | Reuse control-flow primitives for middleware `next`; do not invent middleware-specific traversal.             |
| Session/cookie provenance              | generic session-cookie security constants and scanners                                       | Reuse names only after proving the React Router storage/session source; generic naming alone is insufficient. |
| Client-only render paths               | existing SSR/browser-global and effect/event-handler recognizers                             | Reuse render/effect boundary analysis for `.client` imports.                                                  |
| Internal anchor syntax filters         | `tanstack-start-no-anchor-element`                                                           | Reuse only after adding React Router route-target proof.                                                      |
| Fetch in effects                       | generic `no-fetch-in-effect`                                                                 | Do not add a blanket React Router duplicate.                                                                  |
| Unsafe URL redirect                    | `clickjacking-redirect-risk` and `url-prefilled-privileged-action`                           | Improve the generic security detector if needed; do not add a router-branded duplicate.                       |
| Route/special filenames                | `is-framework-route-or-special-filename` already accepts `react-router` and `remix` runtimes | Extend its route-module coverage after mode detection.                                                        |
| Import provenance                      | `getImportedNameFromModule` / `isImportedFromModule`                                         | Reuse for aliases and package variants.                                                                       |
| Cross-file component tracing           | existing cross-file probe/dependency utilities and Next rules                                | Reuse for Outlet and root-boundary project checks.                                                            |
| Fast Refresh route exports             | `only-export-components` tables already know data-router creators and route exports          | Keep; no new rule.                                                                                            |

Pre- and post-research `truffler` searches found no existing React Router implementation for the
candidate names or behaviors. Exact source searches found the Next.js/TanStack redirect detectors,
TanStack route detectors, request-body security analysis, and shared import, reachability, SSR, and
filename utilities above. The empty `truffler` results for several behavior phrases are not proof
of absence on their own; the registry and filename/source searches provide the confirming audit.

## Daytona pull-request field audit

The first pushed candidate was evaluated against 2,000 pinned open-source projects. Daytona
produced 1,989 baseline reports and 1,981 candidate reports before the shared 18-minute scan budget;
all missing records were explicit time-budget failures, not malformed output or unpinned refs. The
candidate reports contained 55 React Router diagnostics across 36 repositories.

Pinned-source review confirmed the router-factory, render-phase navigation, root error boundary,
route-object, route-lazy, and loader abort-signal findings. It also exposed three detector boundaries
that were too broad:

- Imported `.client` components rendered inside an imported `ClientOnly` render prop are already
  excluded from the server graph. Six findings in `frontvibe/fluid` demonstrated this shape.
- A default-exported `.client` helper nested inside a route folder is not itself a route module. The
  actual `route.tsx` in `frontvibe/fluid` dynamically imported that helper inside `ClientOnly`.
- Mutating the stable `useSearchParams()` value can still synchronize navigation through an
  enclosing setter, a returned serialized URL, or a proven `useNavigate()` call. Six findings in
  `apache/answer` and `Yooooomi/your_spotify` demonstrated those data-flow shapes.

The shipped detectors now abstain on those proven boundaries, and each source shape is preserved as
a regression test. The `.client` JSX rule requires an imported `client-only` render-prop boundary;
the route-suffix rule only treats direct files under `routes/` as statically proven flat route
modules; and the search-param rule follows inline iterator ownership plus returned or navigated
serialization. These exits deliberately trade recall for evidence-backed precision.

## Rejected or deferred ideas

- **Blanket `no-fetch-in-effect` for route files:** already covered generically, and client-only or
  background data can be legitimate even in a route component.
- **Require `HydrateFallback` whenever `clientLoader.hydrate = true`:** official docs allow no
  fallback when server-rendered and client-loaded initial data are identical. Static proof of a
  mismatch is too weak for a default-on rule.
- **Require an error boundary on every data route:** boundaries intentionally protect descendant
  routes. Only root coverage is universal.
- **Ban `<Navigate>` or all navigation in effects:** `<Navigate>` remains necessary in Declarative
  or descendant `Routes`, and `useNavigate` explicitly supports effects. A preference for loader
  redirect requires route/mode and intent evidence that a per-file rule usually lacks.
- **Ban `navigate(-1)`:** the docs caution about missing or cross-domain history entries but also
  document valid modal and wizard uses. Intent is not statically knowable.
- **Always use `Form` or always use `fetcher.Form`:** the correct choice depends on whether the URL
  and history should change. Markup alone rarely proves that product intent.
- **Require `prefetch="intent"` on every Link:** prefetching trades latency for bandwidth and server
  load; it is not universally beneficial.
- **Require custom `shouldRevalidate` to call `defaultShouldRevalidate`:** overriding the default is
  the purpose of the API and can be intentional. An unconditional `false` can still be correct for
  immutable data.
- **Require status 400 for every returned validation-shaped object:** the object's semantic role
  cannot be inferred reliably, and 200 responses can be deliberate.
- **Require only GET/POST on every `Form`:** React Router deliberately supports PUT/PATCH/DELETE.
  Native-form compatibility is a product requirement, not a universal correctness contract.
- **Require cookie secrets on every cookie/session:** unsigned preference cookies are legitimate.
  Correlating an unsigned cookie with auth-sensitive fields may be useful security research, but
  a blanket rule would be noisy and the known file-session vulnerability belongs in dependency
  scanning.
- **Ban response-body reads in all middleware immediately:** the docs steer server middleware to
  status/header changes, but some advanced response transformations may be intentional. Keep the
  narrowly proven body-consumption candidate conditional until open-source evaluation establishes
  its precision.
- **Require every server middleware to call `next()`:** omitting `next` intentionally short-circuits
  the chain, and React Router automatically proceeds when middleware is absent. Only diagnose the
  response-return contract after `next` is actually called.
- **Ban native forms or internal anchors syntactically:** full-document navigation, no-JS behavior,
  resource routes, downloads, and non-router endpoints are all valid. Only project-resolved targets
  make these checks sound.
- **Flag awaited loader promises as non-streaming:** the linter cannot know which data is critical to
  first render. React Router supports both awaited critical data and returned streaming promises.
- **Lint unstable RSC APIs now:** the official skill marks RSC support unstable. Wait for stable
  contracts or gate an experimental ruleset explicitly.

## Suggested implementation order

1. Add React Router presence, mode, installed-version, target-major, SSR/RSC, and package-source
   capabilities. Treat unknown versions conservatively.
2. Ship the syntax/scope P0 rules with small surfaces: loader request body, session mutation in a
   loader, multiple middleware `next`, loader data in proven error UI, and invalid lazy properties.
3. Generalize the existing TanStack render-path/loader-waterfall and cross-framework
   redirect-in-catch detectors instead of cloning them.
4. Add Framework path recognition for root, route, config, client/server-only, and server entry
   modules. Then ship root error coverage, aborted `handleError`, static cookie expiry, and route
   module suffix checks.
5. Build the conservative route/component index and validate it first with missing `Outlet`,
   descendant `Routes` without splat, duplicate IDs, invalid absolute children, and resource links.
6. Add v8 migration diagnostics only behind an explicit target-major setting; switch them to errors
   when v8 is installed. Keep runtime/dependency compatibility in the project scanner.
7. Run focused tests, fuzzing, RDE open-source evaluation, and pull-request parity for each rule
   separately. Test every version gate with fixtures at the boundary minor, not just one v6/v7/v8
   sample. Do not ship project-aware rules until unresolved targets produce zero reports.

The first implementation PR should stay narrow: mode/version foundation plus
`react-router-no-loader-request-body` and `react-router-no-multiple-middleware-next`. Both have
direct primary evidence, compact detectors, hard version gates, and no route-index dependency. The
route index is valuable, but coupling it to the first rule would make review and false-positive
attribution unnecessarily difficult.
