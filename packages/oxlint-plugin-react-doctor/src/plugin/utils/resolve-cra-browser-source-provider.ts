import * as fs from "node:fs";
import * as path from "node:path";
import { readProviderMember } from "./stock-vite-providers/resolve-stock-physical-entry.js";
import { selectStockCraBrowserPackageEntry } from "./select-stock-cra-browser-package-entry.js";
interface Probes {
  readonly existence: (file: string) => void;
  readonly realpath: (file: string) => void;
  readonly content: (file: string) => void;
}
export interface CraSourceProviderInput {
  readonly installationRoot: string;
  readonly issuer: string;
  readonly specifier: string;
  readonly probes: Probes;
}
export interface CraSourceProvider {
  readonly packageDirectory: string;
  readonly entry: string;
  readonly workspace: boolean;
}
const inside = (file: string, root: string): boolean =>
  file === root || file.startsWith(root + path.sep);
const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export function resolveCraBrowserSourceProvider({
  installationRoot: root,
  issuer,
  specifier,
  probes,
}: CraSourceProviderInput): CraSourceProvider | null {
  if (
    !path.isAbsolute(root) ||
    path.resolve(root) !== root ||
    !path.isAbsolute(issuer) ||
    !inside(issuer, root) ||
    !/^(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*$/u.test(specifier)
  )
    return null;
  const parts = specifier.split("/");
  const packageName = parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  if (parts.some((part) => part === "." || part === ".." || part === "node_modules")) return null;
  const stat = (file: string): fs.Stats | undefined => {
    probes.existence(file);
    return fs.lstatSync(file, { throwIfNoEntry: false });
  };
  const canonical = (file: string): boolean => {
    probes.realpath(file);
    return fs.realpathSync(file) === file;
  };
  const manifest = (directory: string): Record<string, unknown> | null => {
    const file = path.join(directory, "package.json"),
      info = stat(file);
    if (!info?.isFile() || info.nlink !== 1 || info.size > 65536 || !canonical(file)) return null;
    const bytes = readProviderMember(file);
    return bytes ? object(JSON.parse(bytes.toString("utf8"))) : null;
  };
  try {
    if (!canonical(root) || !canonical(issuer) || !stat(issuer)?.isFile()) return null;
    // Browser aliases in the nearest issuing package can rewrite bare requests.
    // Self exports also precede node_modules lookup; decline this separate route.
    for (
      let directory = path.dirname(issuer);
      inside(directory, root);
      directory = path.dirname(directory)
    ) {
      if (stat(path.join(directory, "package.json"))) {
        const owner = manifest(directory);
        if (
          !owner ||
          typeof owner.browser === "object" ||
          (owner.name === packageName && owner.exports !== undefined)
        )
          return null;
        break;
      }
      if (directory === root) break;
    }
    for (
      let directory = path.dirname(issuer);
      inside(directory, root);
      directory = path.dirname(directory)
    ) {
      if (path.basename(directory) !== "node_modules") {
        const candidate = path.join(directory, "node_modules", packageName);
        // Webpack may select a file ahead of a package directory.
        if (
          [
            ".web.mjs",
            ".mjs",
            ".web.js",
            ".js",
            ".web.ts",
            ".ts",
            ".web.tsx",
            ".tsx",
            ".json",
            ".web.jsx",
            ".jsx",
          ].some((ext) => stat(candidate + ext))
        )
          return null;
        const info = stat(candidate);
        if (info) {
          let selected = candidate,
            workspace = false;
          if (info.isSymbolicLink()) {
            probes.realpath(candidate);
            selected = fs.realpathSync(candidate);
            if (
              !inside(selected, root) ||
              !canonical(selected) ||
              !stat(selected)?.isDirectory() ||
              fs.readlinkSync(candidate) !== path.relative(path.dirname(candidate), selected)
            )
              return null;
            const rootManifest = manifest(root),
              declarations = rootManifest?.workspaces;
            if (
              !Array.isArray(declarations) ||
              !declarations.length ||
              declarations.some(
                (p) => typeof p !== "string" || !/^[\w.-]+(?:\/[\w.-]+)*(?:\/\*)?$/u.test(p),
              )
            )
              return null;
            const relative = path.relative(root, selected).split(path.sep).join("/");
            if (
              !declarations.some((p) =>
                p.endsWith("/*")
                  ? relative.startsWith(p.slice(0, -1)) &&
                    !relative.slice(p.length - 1).includes("/")
                  : relative === p,
              )
            )
              return null;
            workspace = true;
          } else if (!info.isDirectory() || !canonical(candidate)) return null;
          const metadata = manifest(selected);
          if (!metadata) return null;
          const member = selectStockCraBrowserPackageEntry({
            packageName,
            specifier,
            manifest: metadata,
          });
          if (!member) return null;
          const entry = path.join(selected, member),
            entryInfo = stat(entry);
          if (!entryInfo?.isFile() || entryInfo.nlink !== 1 || !canonical(entry)) return null;
          probes.content(entry);
          return { packageDirectory: selected, entry, workspace };
        }
      }
      if (directory === root) break;
    }
    return null;
  } catch {
    return null;
  }
}
