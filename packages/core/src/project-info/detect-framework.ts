import type { Framework } from "../types/index.js";

const FRAMEWORK_PACKAGES: Record<string, Framework> = {
  next: "nextjs",
  "@tanstack/react-start": "tanstack-start",
  "@remix-run/react": "remix",
  gatsby: "gatsby",
  astro: "astro",
  vite: "vite",
  "react-scripts": "cra",
  expo: "expo",
  "react-native": "react-native",
};

const FRAMEWORK_DISPLAY_NAMES: Record<Framework, string> = {
  nextjs: "Next.js",
  astro: "Astro",
  "tanstack-start": "TanStack Start",
  vite: "Vite",
  cra: "Create React App",
  remix: "Remix",
  gatsby: "Gatsby",
  expo: "Expo",
  "react-native": "React Native",
  preact: "Preact",
  unknown: "React",
};

export const formatFrameworkName = (framework: Framework): string =>
  FRAMEWORK_DISPLAY_NAMES[framework];

// Preact is treated as a framework only when no React-based framework
// (`next` / `vite` / `react-scripts` / …) AND no `react` itself is
// present — i.e. a pure-Preact codebase with no bundler manifest react-
// doctor recognises. Component libraries that list both `react` and
// `preact` as peer deps stay `unknown`, which is what they were before
// this branch existed; they still pick up a non-null `preactVersion`
// (see `discover-project.ts`) so Preact-bucket rules activate without
// overwriting the framework classification.
export const detectFramework = (dependencies: Record<string, string>): Framework => {
  for (const [packageName, frameworkName] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies[packageName]) {
      return frameworkName;
    }
  }
  if (dependencies.preact && !dependencies.react) {
    return "preact";
  }
  return "unknown";
};

const MOBILE_FRAMEWORKS: ReadonlySet<Framework> = new Set(["expo", "react-native"]);

// The cross-workspace merge tier: a monorepo whose `apps/mobile` is Expo and
// `apps/web` is Next.js classifies by the WEB framework no matter which
// workspace the walk visits first — the same web-over-mobile priority
// `detectFramework` applies within one manifest. Web wins because it's
// coverage-maximizing: `rn-*` / Expo rules still load via
// `hasReactNativeWorkspace` / `expoVersion`, while the web framework's rules
// gate on this classification alone. Within a tier (two web apps, or two
// mobile apps) the first workspace in walk order keeps the slot; `unknown`
// never displaces anything.
export const frameworkMergeRank = (framework: Framework): number => {
  if (framework === "unknown") return 3;
  return MOBILE_FRAMEWORKS.has(framework) ? 2 : 1;
};
