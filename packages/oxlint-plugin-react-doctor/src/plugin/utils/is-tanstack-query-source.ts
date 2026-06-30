// TanStack Query packages (`@tanstack/react-query`, `@tanstack/vue-query`,
// `@tanstack/query-core`, the Angular `*-query-experimental`, …) plus the
// legacy `react-query`. A `useQuery` imported from anything else — notably
// Convex's `convex/react`, whose `useQuery` returns the data directly — must
// not be treated as a TanStack result object.
const TANSTACK_QUERY_PACKAGE_PATTERN = /^@tanstack\/[\w-]*query[\w-]*$/;

export const isTanstackQuerySource = (source: string): boolean =>
  TANSTACK_QUERY_PACKAGE_PATTERN.test(source) || source === "react-query";
