import * as path from "node:path";
import type { StencilOutputPath } from "./read-contained-stencil-outputs.js";
export interface Stencil2OutputProjection {
  builtinOutputTargets: readonly Readonly<Record<string, unknown>>[];
  localOutputFactories: readonly { proxiesFile: string }[];
}
/** Only fields/defaults from the verified Stencil2 output validators.
 * dist.esmLoaderPath is relative to normalized dist.dir, not projectRoot. */
export function collectStencil2OutputPaths(
  projectDirectory: string,
  generatedConfig: string,
  p: Stencil2OutputProjection,
): readonly StencilOutputPath[] | null {
  const out: StencilOutputPath[] = [
    { absolutePath: generatedConfig, kind: "file", role: "generated-config" },
  ];
  for (const target of p.builtinOutputTargets) {
    const allowed =
      target.type === "dist"
        ? ["type", "dir", "esmLoaderPath", "empty", "isPrimaryPackageOutputTarget"]
        : target.type === "dist-custom-elements"
          ? ["type", "dir", "minify", "autoDefineCustomElements", "generateTypeDeclarations"]
          : target.type === "dist-hydrate-script"
            ? ["type", "dir"]
            : [];
    if (Object.keys(target).some((k) => !allowed.includes(k))) return null;
    let directory: string;
    if (target.type === "dist") directory = "dist";
    else if (target.type === "dist-custom-elements") directory = "dist/components";
    else if (target.type === "dist-hydrate-script") directory = "dist/hydrate";
    else return null;
    if (target.dir !== undefined && typeof target.dir !== "string") return null;
    const dest = path.resolve(
      projectDirectory,
      typeof target.dir === "string" ? target.dir : directory,
    );
    out.push({ absolutePath: dest, kind: "directory", role: "builtin" });
    if (target.type === "dist-custom-elements" && target.generateTypeDeclarations === true)
      out.push({
        absolutePath: path.resolve(projectDirectory, "dist/types"),
        kind: "directory",
        role: "builtin",
      });
    if (target.type === "dist") {
      if (target.esmLoaderPath !== undefined && typeof target.esmLoaderPath !== "string")
        return null;
      out.push({
        absolutePath: path.resolve(
          dest,
          typeof target.esmLoaderPath === "string" ? target.esmLoaderPath : "loader",
        ),
        kind: "directory",
        role: "builtin",
      });
    }
  }
  for (const factory of p.localOutputFactories) {
    if (typeof factory.proxiesFile !== "string") return null;
    out.push({
      absolutePath: path.resolve(projectDirectory, factory.proxiesFile),
      kind: "file",
      role: "proxy",
    });
  }
  return out;
}
