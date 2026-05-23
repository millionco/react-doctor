import type { PackageJson } from "../../types/index.js";
import { extractCatalogName } from "../resolve-catalog-version.js";

export interface DependencyDeclaration {
  catalogReference: string | null;
  hasDeclaration: boolean;
  version: string | null;
}

interface GetDependencyDeclarationOptions {
  packageJson: PackageJson;
  packageName: string;
  sections: ReadonlyArray<"dependencies" | "peerDependencies" | "devDependencies">;
}

export const getDependencyDeclaration = ({
  packageJson,
  packageName,
  sections,
}: GetDependencyDeclarationOptions): DependencyDeclaration => {
  for (const section of sections) {
    const version = packageJson[section]?.[packageName];
    if (version === undefined) continue;

    return {
      catalogReference: extractCatalogName(version) ?? null,
      hasDeclaration: true,
      version,
    };
  }

  return {
    catalogReference: null,
    hasDeclaration: false,
    version: null,
  };
};
