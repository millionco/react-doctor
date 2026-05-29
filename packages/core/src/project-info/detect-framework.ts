import type { Framework } from "../types/index.js";

const FRAMEWORK_PACKAGES: Record<string, Framework> = {
  next: "nextjs",
  "@tanstack/react-start": "tanstack-start",
  vite: "vite",
  "react-scripts": "cra",
  "@remix-run/react": "remix",
  gatsby: "gatsby",
  expo: "expo",
  "react-native": "react-native",
};

const FRAMEWORK_DISPLAY_NAMES: Record<Framework, string> = {
  nextjs: "Next.js",
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
