export const PAGE_FILE_PATTERN = /\/page\.(tsx?|jsx?)$/;
export const PAGE_OR_LAYOUT_FILE_PATTERN = /\/(page|layout)\.(tsx?|jsx?)$/;

export const INTERNAL_PAGE_PATH_PATTERN =
  /\/(?:(?:\((?:dashboard|admin|settings|account|internal|manage|console|portal|auth|onboarding|app|ee|protected)\))|(?:dashboard|admin|settings|account|internal|manage|console|portal))\//i;

export const OG_ROUTE_PATTERN = /\/og\b/i;

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

export const ROUTE_HANDLER_FILE_PATTERN = /\/route\.(tsx?|jsx?)$/;

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

export const ERROR_BOUNDARY_FILE_PATTERN = /\/(error|global-error)\.(tsx?|jsx?)$/;

export const GLOBAL_ERROR_FILE_PATTERN = /\/global-error\.(tsx?|jsx?)$/;

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

export const OG_IMAGE_FILE_PATTERN = /\/(opengraph-image|twitter-image)\d*\.(tsx?|jsx?)$/;
