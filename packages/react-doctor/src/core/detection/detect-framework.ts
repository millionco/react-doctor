import type { Framework } from "../../types/project-info.js";

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
  unknown: "React",
};

export const formatFrameworkName = (framework: Framework): string =>
  FRAMEWORK_DISPLAY_NAMES[framework];

export const detectFramework = (dependencies: Record<string, string>): Framework => {
  for (const [packageName, frameworkName] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies[packageName]) {
      return frameworkName;
    }
  }
  return "unknown";
};
