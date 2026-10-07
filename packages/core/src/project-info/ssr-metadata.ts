import type { PackageJson } from "../types/index.js";
import { hasAnyDependency } from "./has-any-dependency.js";

const SSR_DEPENDENCY_NAMES = [
  "@react-router/cloudflare",
  "@react-router/node",
  "@react-router/serve",
  "vike",
  "vite-plugin-ssr",
] as const;

export const isPackageJsonSsrAware = (packageJson: PackageJson): boolean => {
  return hasAnyDependency(packageJson, SSR_DEPENDENCY_NAMES);
};
