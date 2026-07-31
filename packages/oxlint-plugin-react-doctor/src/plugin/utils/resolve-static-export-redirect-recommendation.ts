import type { CapabilityQuery } from "./capability.js";

const STATIC_EXPORT_RECOMMENDATION =
  'Avoid redirects inside useEffect — they flash the wrong page first. Use an event handler (e.g. onClick), or call redirect() from next/navigation during render (it prerenders a client-side redirect under output: "export"). Middleware and getServerSideProps redirects aren\'t available in a static export.';

export const resolveStaticExportRedirectRecommendation = (
  hasCapability: CapabilityQuery,
): string | undefined =>
  hasCapability("nextjs:static-export") ? STATIC_EXPORT_RECOMMENDATION : undefined;
