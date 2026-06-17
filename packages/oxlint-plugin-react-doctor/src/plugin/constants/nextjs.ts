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

export const PAGES_DIRECTORY_PATTERN = /\/pages\//;

export const NEXTJS_NAVIGATION_FUNCTIONS = new Set([
  "redirect",
  "permanentRedirect",
  "notFound",
  "forbidden",
  "unauthorized",
]);

export const GOOGLE_FONTS_PATTERN = /fonts\.googleapis\.com/;

export const POLYFILL_SCRIPT_PATTERN = /polyfill\.io|polyfill\.min\.js|cdn\.polyfill/;

export const APP_DIRECTORY_PATTERN = /\/app\//;

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
