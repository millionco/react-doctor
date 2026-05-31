// Real-world API keys, tokens, and credentials are 24+ chars. 8 chars produced
// many false positives on UI strings ("loading...", short captions, etc.).
export const SECRET_MIN_LENGTH_CHARS = 24;
export const AUTH_CHECK_LOOKAHEAD_STATEMENTS = 10;

export const AUTH_FUNCTION_NAMES = new Set([
  "auth",
  "getSession",
  "getServerSession",
  "getUser",
  "requireAuth",
  "checkAuth",
  "verifyAuth",
  "authenticate",
  "currentUser",
  "getAuth",
  "validateSession",
]);

// Auth function names that are too generic to recognize on their own
// when called as a method (e.g. `analytics.getUser()` is not an auth
// check). For these names a member call is only accepted when the
// receiver expression looks auth-related per AUTH_OBJECT_PATTERN.
// Bare identifier calls (`getUser()`) stay accepted because callers
// who import `getUser` from an auth library normally do so as the
// canonical name; renaming an analytics helper to bare `getUser`
// would be unusual.
export const GENERIC_AUTH_METHOD_NAMES = new Set(["getUser"]);

// Receiver-expression substrings that signal an auth-related namespace
// when paired with a generic method name like `.getUser()`. Matched
// case-insensitively against the dotted source of the member-call
// receiver (e.g. `ctx.auth`, `auth0`, `clerkClient`). Kept tight on
// purpose — we accept obvious auth providers (auth/clerk/session/jwt/
// supabase…) and skip ambiguous nouns like "user" that show up in
// non-auth namespaces (`userAnalytics`, `userStore`, …).
//
// Every alternative MUST be a substring that can actually appear in a
// JavaScript identifier — i.e. no hyphens. `buildDottedReceiverSource`
// only emits Identifier names joined by `.`, so any alternative with
// `-` is dead code (it can never match). `auth` already covers most
// "better-auth" and "iron-session" usage via the canonical `auth`
// re-export those libraries ship.
export const AUTH_OBJECT_PATTERN =
  /(?:^|[._])(?:auth|authn|authz|clerk|session|jwt|firebase|supabase|nextauth|kinde|workos|stytch|descope|cognito|propelauth|lucia)/i;

export const SECRET_PATTERNS = [
  /^sk_live_/,
  /^sk_test_/,
  /^AKIA[0-9A-Z]{16}$/,
  /^ghp_[a-zA-Z0-9]{36}$/,
  /^gho_[a-zA-Z0-9]{36}$/,
  /^github_pat_/,
  /^glpat-/,
  /^xox[bporas]-/,
  /^sk-[a-zA-Z0-9]{32,}$/,
];

// Public, client-safe keys that vendors *design* to ship in the browser
// bundle. Each carries a non-secret, type-identifying prefix that is
// distinct from the same vendor's secret key — RevenueCat public
// `appl_`/`goog_`/`amzn_`/`strp_` vs secret `sk_`; Stripe/Clerk
// publishable `pk_` vs secret `sk_`; Supabase `sb_publishable_` vs
// `sb_secret_`; Mapbox public `pk.` vs secret `sk.`; PostHog project
// `phc_` vs personal `phx_`; Stytch `public-token-` vs `secret-`. A
// literal matching one of these is intentionally publishable, so the
// rule must not flag it as a leaked secret via either the secret-shape
// patterns or the variable-name heuristic. Anchored at the start and
// written with linear-time constructs (no nested quantifiers) so a long
// literal can't trigger catastrophic backtracking; every prefix is
// unique to a vendor's *public* key and never collides with that
// vendor's secret shape.
//
// Intentionally excluded — ambiguous formats that can be public OR
// sensitive depending on configuration, so flagging stays the safe
// default: Google/Firebase browser keys (`AIza…`, the same shape as
// unrestricted server keys) and bare Supabase JWTs (`eyJ…`, whose public
// `anon` and secret `service_role` variants are indistinguishable by
// shape; the new `sb_publishable_` format above is the safe opt-in).
export const PUBLIC_CLIENT_KEY_PATTERNS = [
  /^appl_/, // RevenueCat public SDK key (Apple)
  /^goog_/, // RevenueCat public SDK key (Google)
  /^amzn_/, // RevenueCat public SDK key (Amazon)
  /^strp_/, // RevenueCat public SDK key (Stripe)
  /^pk_(?:live|test)_/, // Stripe / Clerk publishable key
  /^sb_publishable_/, // Supabase publishable key (new format)
  /^phc_/, // PostHog project (client) API key
  /^public-token-(?:live|test)-/, // Stytch public token
  /^pk\.eyJ/, // Mapbox public access token (pk. + JWT)
];

export const SECRET_VARIABLE_PATTERN = /(?:api_?key|secret|token|password|credential|auth)/i;

export const SECRET_TOOLING_FILE_PATTERN = /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/;

export const SECRET_TOOLING_RC_FILE_PATTERN = /(?:^|\/)(?:\.[a-z-]+rc|[a-z-]+\.rc)\.[cm]?[jt]s$/;

export const SECRET_TEST_FILE_PATTERN =
  /(?:^|\/)[^/]+\.(?:test|spec|stories|story|fixture|fixtures)\.[cm]?[jt]sx?$/;

export const SECRET_SERVER_FILE_SUFFIX_PATTERN = /(?:^|\/)[^/]+\.server\.[cm]?[jt]sx?$/;

export const SECRET_SERVER_ENTRY_FILE_PATTERN = /(?:^|\/)(?:middleware|route)\.[cm]?[jt]sx?$/;

export const SECRET_NEXT_PAGES_API_FILE_PATTERN = /(?:^|\/)pages\/api\/.+\.[cm]?[jt]sx?$/;

export const SECRET_CLIENT_FILE_SUFFIX_PATTERN =
  /(?:^|\/)[^/]+\.(?:client|browser|web)\.[cm]?[jt]sx?$/;

export const SECRET_CLIENT_ENTRY_FILE_PATTERN =
  /(?:^|\/)(?:src\/)?(?:main|index|[Aa]pp|client)\.[cm]?[jt]sx?$/;

export const SECRET_SERVER_DIRECTORY_NAMES = new Set([
  "backend",
  "functions",
  "lambdas",
  "lambda",
  "middleware",
  "server",
  "servers",
]);

export const SECRET_SERVER_SOURCE_ROOT_OWNER_NAMES = new Set([
  "api",
  "backend",
  "edge",
  "function",
  "functions",
  "lambda",
  "lambdas",
  "server",
  "servers",
  "worker",
  "workers",
]);

export const SECRET_TEST_DIRECTORY_NAMES = new Set([
  "__fixtures__",
  "__mocks__",
  "__tests__",
  "fixtures",
  "mocks",
  "test",
  "tests",
]);

export const SECRET_TOOLING_DIRECTORY_NAMES = new Set([
  "bin",
  "config",
  "configs",
  "script",
  "scripts",
  "tooling",
  "tools",
]);

export const SECRET_CLIENT_SOURCE_DIRECTORY_NAMES = new Set([
  "components",
  "features",
  "hooks",
  "pages",
  "ui",
  "views",
  "widgets",
]);

export const SECRET_FALSE_POSITIVE_SUFFIXES = new Set([
  "modal",
  "label",
  "text",
  "title",
  "name",
  "id",
  "url",
  "path",
  "route",
  "page",
  "param",
  "field",
  "column",
  "header",
  "placeholder",
  "prefix",
  "description",
  "type",
  "icon",
  "class",
  "style",
  "variant",
  "event",
  "action",
  "status",
  "state",
  "mode",
  "flag",
  "option",
  "config",
  "message",
  "error",
  "display",
  "view",
  "component",
  "element",
  "container",
  "wrapper",
  "button",
  "link",
  "input",
  "select",
  "dialog",
  "menu",
  "form",
  "step",
  "index",
  "count",
  "length",
  "role",
  "scope",
  "context",
  "provider",
  "ref",
  "handler",
  "query",
  "schema",
  "constant",
]);
