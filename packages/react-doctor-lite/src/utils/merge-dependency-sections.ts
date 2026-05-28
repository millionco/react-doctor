import type { DependencyManifest } from "../types.js";

// Flattens every dependency section of a manifest into a single
// name -> version-spec map. `dependencies` is applied last so a runtime
// dependency wins over a peer/dev declaration of the same package.
export const mergeDependencySections = (manifest: DependencyManifest): Map<string, string> => {
  const merged = new Map<string, string>();
  const sections = [
    manifest.optionalDependencies,
    manifest.peerDependencies,
    manifest.devDependencies,
    manifest.dependencies,
  ];
  for (const section of sections) {
    if (!section) continue;
    for (const [name, spec] of Object.entries(section)) {
      merged.set(name, spec);
    }
  }
  return merged;
};
