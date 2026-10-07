import type { CapabilityQuery } from "./capability.js";

const FRAMEWORK_ENV_ADVICE = [
  ["nextjs", "Next.js", "NEXT_PUBLIC_*"],
  ["vite", "Vite", "VITE_*"],
  ["tanstack-start", "TanStack Start", "VITE_*"],
  ["cra", "Create React App", "REACT_APP_*"],
  ["gatsby", "Gatsby", "GATSBY_*"],
] as const;

export const resolveClientSecretRecommendation = (
  hasCapability: CapabilityQuery,
): string | undefined => {
  for (const [frameworkToken, frameworkName, publicEnvPrefix] of FRAMEWORK_ENV_ADVICE) {
    if (hasCapability(frameworkToken)) {
      return `Move secrets to server-only code. In ${frameworkName}, only \`${publicEnvPrefix}\` env vars are exposed to the browser, and they must not contain secrets`;
    }
  }
  return undefined;
};
