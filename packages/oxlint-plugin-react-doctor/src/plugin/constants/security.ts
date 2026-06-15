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

// Token-level vocabulary for recognizing auth-guard call names by
// CONVENTION instead of an exact allowlist (`requireAdmin`,
// `getAdminSession`, `ensureSignedIn`, `hasRole` …). A callee name is split
// into lowercased words (see `tokenizeIdentifierWords`) and classified by
// `isAuthGuardName`. The split keeps the matcher precise: substring checks
// would wrongly flag `getAuthor` (contains "auth") or `getUsername`
// (contains "user"); word tokens never do.
//
// Matches `auth`, `authn`, `authz`, `authed`, `authenticate(d)`,
// `authentication`, `authorize(d)`, `authorization` — but NOT `author` or
// `authority` (those leave an unmatched suffix).
export const AUTH_STRONG_TOKEN_PATTERN =
  /^auth(?:n|z|ed|enticate[ds]?|enticating|entication|orize[ds]?|orizing|orization|orizer)?$/;

// Unambiguous multi-word auth phrases, pre-merged from adjacent tokens
// (`signedIn` -> "signedin"). Each is an auth signal on its own.
export const AUTH_STANDALONE_NOUN_TOKENS = new Set(["signedin", "loggedin", "signin"]);

// Verbs that assert/check a condition. Paired with ANY auth noun they read
// as a guard (`requireAdmin`, `checkPermission`, `verifyToken`, `isAdmin`,
// `hasRole`, `mustBeAdmin`).
export const AUTH_ASSERTIVE_VERB_TOKENS = new Set([
  "require",
  "ensure",
  "assert",
  "verify",
  "validate",
  "check",
  "protect",
  "enforce",
  "guard",
  "gate",
  "restrict",
  "is",
  "has",
  "can",
  "must",
]);

// Verbs that merely read a value. Paired with a STRONG auth noun they read
// as an auth lookup (`getSession`, `fetchSession`, `useSession`); paired
// with only a WEAK noun (`getUser`, `getToken`) they stay ambiguous and are
// NOT treated as a guard.
export const AUTH_GETTER_VERB_TOKENS = new Set([
  "get",
  "fetch",
  "load",
  "read",
  "resolve",
  "retrieve",
  "use",
]);

// "Whose" qualifiers that bind a weak noun to the current principal
// (`currentUser`, `getCurrentUser`, `myAccount`).
export const AUTH_QUALIFIER_TOKENS = new Set(["current", "my", "own"]);

// Nouns that point squarely at authn/authz state.
export const AUTH_STRONG_NOUN_TOKENS = new Set([
  "session",
  "sessions",
  "login",
  "admin",
  "admins",
  "superadmin",
  "superuser",
  "role",
  "roles",
  "permission",
  "permissions",
  "jwt",
  "identity",
  "principal",
  "credential",
  "credentials",
]);

// Nouns that are auth-adjacent but also appear on non-auth objects
// (`analytics.getUser()`, `csrf.getToken()`); only count as auth when an
// assertive verb or a "whose" qualifier accompanies them.
export const AUTH_WEAK_NOUN_TOKENS = new Set([
  "user",
  "users",
  "account",
  "accounts",
  "token",
  "tokens",
  "access",
  "me",
  "viewer",
  "caller",
  "subject",
  "scope",
  "scopes",
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

// Whole-content credential patterns for the security-scan scan rules
// (unanchored sweep over full file contents), distinct from
// SECRET_PATTERNS above, which anchor individual string-literal values
// for `no-secrets-in-client-code`. Kept byte-identical to the original
// scanner; unifying the two families is a tracked follow-up — do not
// merge them without re-validating both consumers.
export const SECRET_VALUE_PATTERNS = [
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{35,}["']?/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\brk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{20,}\b/,
  /\blin_(?:api|oauth)_[A-Za-z0-9]{20,}\b/,
  /\bvercel_[A-Za-z0-9]{20,}\b/,
  /\bsntrys_[A-Za-z0-9_-]{20,}\b/,
  /\bkey-[a-f0-9]{32}\b/i,
  /\bnpm_[A-Za-z0-9]{30,}\b/,
  /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/,
  /https:\/\/discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/,
  /\bsb_secret_[A-Za-z0-9_]{20,}\b/,
  /\bservice_role\b/i,
  /"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
  // Placeholder credentials (postgres://user:pass@..., myusername:mypassword)
  // are how compose templates and sample envs document the URL shape, and a
  // dotless host is a docker-network service name (or localhost) that no
  // credential can reach from outside the deployment.
  /\b(?:postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:(?!(?:pass(?:word)?|my[a-z]*pass(?:word)?|mysecretpassword|myusername|postgres|mysql|redis|root|admin|minioadmin|secret|example|changeme|change_me|test|guest|placeholder|default|user(?:name)?|x{3,}|\*{2,}|\$\{[^}]*\}|\$[A-Z_]+|<[^>]*>|%[\w.]+%|\{\{[^}]*\}\})@)[^@\s/]+@(?!(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal)(?:[:/\s]|$))[^\s:/@]*\./i,
];

export const PUBLIC_ENV_SECRET_NAME_PATTERN =
  /\b(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)_[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE|DATABASE_URL|SERVICE_ROLE|AWS_ACCESS_KEY|AWS_SECRET)[A-Z0-9_]*\b/i;

export const FULL_ENV_LEAK_CONTEXT_PATTERN =
  /\b(?:process\.env|import\.meta\.env|window\.__[A-Z0-9_]*ENV[A-Z0-9_]*__|__[A-Z0-9_]*ENV[A-Z0-9_]*__)\b/;

export const FULL_ENV_LEAK_SECRET_NAME_PATTERN =
  /\b(?:DATABASE_URL|AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|MAILGUN_API_KEY|SALESFORCE_CLIENT_SECRET|OKTA_CLIENT_SECRET|SESSION_SECRET|COOKIE_SECRET|PRIVATE_KEY|SERVICE_ROLE)\b/;

// TODO(follow-up): de-overfit — several vendor names here mirror specific
// regression fixtures (TLDRAW / POSTHOG / ALGOLIA / GC_API_KEY).
export const TRUSTED_PUBLIC_SECRET_NAME_PATTERN =
  /(?:SENTRY_DSN|PUBLIC_KEY|PUBLISHABLE|ANON_KEY|POSTHOG_(?:PROJECT_)?TOKEN|POSTHOG_KEY|TLDRAW_LICENSE_KEY|CLERK_PUBLISHABLE_KEY|ALGOLIA_SEARCH_KEY|GC_API_KEY|GOOGLE_MAPS_API_KEY|MAPBOX_TOKEN|MIXPANEL_TOKEN|(?:NEXT_PUBLIC|VITE|REACT_APP|EXPO_PUBLIC)_(?:DISABLE|ENABLE|ALLOW|REQUIRE)_)/i;

// Public, client-safe keys designed to ship in the browser, each with a
// prefix distinct from the same vendor's secret key (RevenueCat `appl_`
// vs `sk_`, Supabase `sb_publishable_` vs `sb_secret_`, …); a literal
// matching one must never be flagged. Ambiguous shapes are omitted so they
// stay flagged: Google `AIza…` (also unrestricted server keys) and Supabase
// `anon`/`service_role` JWTs (`eyJ…`, indistinguishable by shape).
export const PUBLIC_CLIENT_KEY_PATTERNS = [
  /^appl_/, // RevenueCat (Apple)
  /^goog_/, // RevenueCat (Google)
  /^amzn_/, // RevenueCat (Amazon)
  /^strp_/, // RevenueCat (Stripe)
  /^pk_(?:live|test)_/, // Stripe / Clerk publishable
  /^sb_publishable_/, // Supabase publishable
  /^phc_/, // PostHog project key
  /^public-token-(?:live|test)-/, // Stytch public token
  /^pk\.eyJ/, // Mapbox public token
];

export const SECRET_UNAMBIGUOUS_PLACEHOLDER_VALUE_PATTERNS = [
  /^[\s._\-*\u2022xX]{8,}$/,
  /(?:\.{3,}|\u2026|[*\u2022]{3,})/,
  /(?:^|[_\-\s])(?:your|redacted|masked|placeholder|replace[_\-\s]?me|changeme)(?:$|[_\-\s])/i,
  /<[^>]*(?:auth|credential|key|password|secret|token|your|redacted|placeholder|masked)[^>]*>/i,
  /\[[^\]]*(?:auth|credential|key|password|secret|token|your|redacted|placeholder|masked)[^\]]*\]/i,
  /\{[^}]*(?:auth|credential|key|password|secret|token|your|redacted|placeholder|masked)[^}]*\}/i,
];

export const SECRET_CONTEXTUAL_PLACEHOLDER_VALUE_PATTERNS = [
  /(?:^|[_\-\s])(?:example|sample|dummy)(?:$|[_\-\s])/i,
];

export const SECRET_PLACEHOLDER_CONTEXT_PATTERN =
  /(?:placeholder|example|sample|dummy|masked|redacted|mask)/i;

export const SECRET_VARIABLE_PATTERN = /(?:api_?key|secret|token|password|credential|auth)/i;

export const SECRET_TOOLING_FILE_PATTERN = /(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/;

export const SECRET_TOOLING_RC_FILE_PATTERN = /(?:^|\/)(?:\.[a-z-]+rc|[a-z-]+\.rc)\.[cm]?[jt]s$/;

export const SECRET_TEST_FILE_PATTERN =
  /(?:^|\/)[^/]+\.(?:test|spec|stories|story|fixture|fixtures)\.[cm]?[jt]sx?$/;

export const SECRET_SERVER_FILE_SUFFIX_PATTERN = /(?:^|\/)[^/]+\.server\.[cm]?[jt]sx?$/;

export const SECRET_SERVER_ENTRY_FILE_PATTERN = /(?:^|\/)(?:middleware|proxy|route)\.[cm]?[jt]sx?$/;

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
