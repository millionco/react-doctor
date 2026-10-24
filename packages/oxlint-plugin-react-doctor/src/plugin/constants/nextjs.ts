export const NEXTJS_SOURCE_FILE_EXTENSION_GROUP = "(?:tsx?|jsx?|mts|mjs)";

export const PAGE_FILE_PATTERN = new RegExp(`/page\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`);
export const PAGE_OR_LAYOUT_FILE_PATTERN = new RegExp(
  `/(page|layout)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);

// Candidate `layout.*` filenames an App Router directory walk probes. Mirrors
// the extensions in NEXTJS_SOURCE_FILE_EXTENSION_GROUP so `.mts`/`.mjs`
// layouts are recognized too.
export const LAYOUT_FILE_NAMES = [
  "layout.tsx",
  "layout.jsx",
  "layout.ts",
  "layout.js",
  "layout.mts",
  "layout.mjs",
];

// Export names that give an App Router page its search-preview metadata.
export const METADATA_EXPORT_NAMES = ["metadata", "generateMetadata"];

export const INTERNAL_PAGE_PATH_PATTERN =
  /\/(?:(?:\((?:dashboard|admin|settings|account|internal|manage|console|portal|auth|onboarding|app|ee|protected)\))|(?:dashboard|admin|settings|account|internal|manage|console|portal))\//i;

export const NEXTJS_NAVIGATION_FUNCTIONS = new Set([
  "redirect",
  "permanentRedirect",
  "notFound",
  "forbidden",
  "unauthorized",
]);

// Next.js cache-invalidation helpers from `next/cache`. Calling one only
// busts the data cache — it reads no data and mutates no records — so a
// server action whose only work is revalidation is not a privileged
// operation and needs no auth guard.
export const CACHE_REVALIDATION_FUNCTION_NAMES = new Set([
  "revalidateTag",
  "revalidatePath",
  "expireTag",
  "expirePath",
  "unstable_expireTag",
  "unstable_expirePath",
]);

export const GOOGLE_FONTS_PATTERN = /fonts\.googleapis\.com/;

export const POLYFILL_SCRIPT_PATTERN = /polyfill\.io|polyfill\.min\.js|cdn\.polyfill/;

export const ROUTE_HANDLER_FILE_PATTERN = new RegExp(
  `/route\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);

export const CRON_ROUTE_PATTERN = /\/(?:cron|jobs\/cron)(?:\/|$)/i;

export const MUTATING_ROUTE_SEGMENTS = new Set([
  "logout",
  "log-out",
  "signout",
  "sign-out",
  "unsubscribe",
  "delete",
  "remove",
  "revoke",
  "cancel",
  "deactivate",
]);

export const ERROR_BOUNDARY_FILE_PATTERN = new RegExp(
  `/(error|global-error)\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);

export const GLOBAL_ERROR_FILE_PATTERN = new RegExp(
  `/global-error\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);

export const ROUTE_HANDLER_HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
]);

export const GOOGLE_ANALYTICS_SCRIPT_PATTERN = /google-analytics\.com|googletagmanager\.com\/gtag/;

export const OG_IMAGE_FILE_PATTERN = new RegExp(
  `/(opengraph-image|twitter-image)\\d*\\.${NEXTJS_SOURCE_FILE_EXTENSION_GROUP}$`,
);

export const NEXT_QUERY_SUPPORTED_MAJOR_VERSION = 16;
export const NEXT_QUERY_SINGLE_VALUE_COUNT = 1;
export const NEXT_QUERY_SET_ARGUMENT_COUNT = 2;
export const NEXT_QUERY_CONFIG_FILE_NAMES = [
  "next.config.ts",
  "next.config.js",
  "next.config.mjs",
  "next.config.mts",
];
export const NEXT_QUERY_PROVIDER_MEMBERS: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "URLSearchParams",
  "Array",
  "Function",
  "eval",
  "require",
  "module",
  "defaultView",
  "contentWindow",
  "ownerDocument",
  "view",
  "valueOf",
]);
export const NEXT_QUERY_OUTSIDE_REFUSED_MEMBERS: ReadonlySet<string> = new Set([
  "constructor",
  "prototype",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "getPrototypeOf",
  "setPrototypeOf",
  "getOwnPropertyDescriptor",
  "getOwnPropertyDescriptors",
  "defineProperty",
  "defineProperties",
  "URLSearchParams",
  "Array",
  "Object",
  "Reflect",
  "Function",
  "eval",
  "require",
  "module",
]);
export const NEXT_QUERY_ARRAY_METHODS: ReadonlySet<string> = new Set(["from", "isArray", "of"]);
export const NEXT_QUERY_OBJECT_METHODS: ReadonlySet<string> = new Set([
  "keys",
  "values",
  "entries",
  "is",
  "hasOwn",
]);
export const NEXT_QUERY_REACT_PROVIDER_SOURCES: ReadonlySet<string> = new Set([
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
]);
export const NEXT_QUERY_UNSUPPORTED_MODULE_SOURCES: ReadonlySet<string> = new Set([
  "module",
  "node:module",
  "vm",
  "node:vm",
  "next/script",
]);
export const NEXT_QUERY_ACTIVE_HTML_ELEMENTS: ReadonlySet<string> = new Set([
  "script",
  "iframe",
  "embed",
  "object",
]);
export const NEXT_QUERY_ACTIVE_HTML_ATTRIBUTES: ReadonlySet<string> = new Set([
  "srcDoc",
  "dangerouslySetInnerHTML",
]);
export const NEXT_QUERY_WINDOW_CARRIER_MEMBERS: ReadonlySet<string> = new Set([
  "defaultView",
  "contentWindow",
  "view",
  "window",
  "self",
  "top",
  "parent",
  "frames",
  "opener",
]);
export const NEXT_QUERY_MAX_WINDOW_ALIAS_COUNT = 32;
