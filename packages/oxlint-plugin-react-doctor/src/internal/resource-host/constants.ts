import type { ResourceDependency } from "./resource-host.js";

export const RESOURCE_DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] satisfies ReadonlyArray<ResourceDependency["section"]>;
