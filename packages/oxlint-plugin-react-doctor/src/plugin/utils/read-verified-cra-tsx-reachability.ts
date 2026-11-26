import * as fs from "node:fs";
import * as path from "node:path";
import {
  buildSourceProjectIndex,
  readSelectedTypedSourceClosure,
  type SourceProjectTypedEdgeReader,
} from "./build-source-project-index.js";
import { recordExistenceProbe, recordRealpathProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { readPhysicalImplicitJsxProgram } from "./read-physical-implicit-jsx-program.js";
import type { RuleContext } from "./rule-context.js";

// Verified react-scripts 5.0.1 uses this order when its selected
// application tsconfig exists. CRA paths uses the same order for appIndexJs.
const TYPED_CRA_EXTENSIONS = [
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
];

const readStat = (filename: string): fs.Stats | undefined => {
  recordExistenceProbe(filename);
  return fs.lstatSync(filename, { throwIfNoEntry: false });
};

const isCanonicalPath = (filename: string): boolean => {
  recordRealpathProbe(filename);
  return fs.realpathSync(filename) === filename;
};

const selectFile = (candidates: readonly string[]): string | null => {
  for (const candidate of candidates) {
    const info = readStat(candidate);
    if (!info) continue;
    // Refuse an opaque winner without picking a lower priority file.
    return info.isFile() && info.nlink === 1 && isCanonicalPath(candidate) ? candidate : null;
  }
  return null;
};

const selectCraRelativeSource = (candidate: string): string | null => {
  const exact = readStat(candidate);
  if (exact?.isSymbolicLink()) return null;
  const extensions = TYPED_CRA_EXTENSIONS.map((extension) => candidate + extension);
  const selected = selectFile(exact?.isDirectory() ? extensions : [candidate, ...extensions]);
  if (selected || !exact?.isDirectory()) return selected;

  // A local manifest changes Webpack directory-main and browser aliases.
  // Also decline a competing filename that could not be authenticated.
  if (readStat(path.join(candidate, "package.json"))) return null;
  if (extensions.some(readStat)) return null;
  const index = path.join(candidate, "index");
  return selectFile([index, ...TYPED_CRA_EXTENSIONS.map((extension) => index + extension)]);
};

const createTypedEdgeReader =
  (sourceDirectory: string): SourceProjectTypedEdgeReader =>
  (module, _node, request) => {
    if (request === null) return null;
    if (/[!?#:\\]/u.test(request) || /(?:^|[./])macro(?:$|[./])/iu.test(request)) {
      return { kind: "opaque" };
    }
    if (!/^\.{1,2}\//u.test(request)) {
      return /^[\w@][\w@./-]*$/u.test(request) ? { kind: "external" } : { kind: "opaque" };
    }
    const candidate = path.resolve(path.dirname(module.filePath), request);
    if (!isPathInside(candidate, sourceDirectory)) return { kind: "opaque" };
    const selected = selectCraRelativeSource(candidate);
    if (selected?.endsWith(".json")) return { kind: "data", filenames: [selected] };
    if (selected && /\.(?:mjs|js|jsx|ts|tsx)$/u.test(selected) && !selected.endsWith(".d.ts")) {
      return { kind: "file", filename: selected };
    }
    return { kind: "opaque" };
  };

interface VerifiedTypedCraReachabilityInput {
  // The caller first establishes typed CRA5 appSrc, its ordinary resolver,
  // root configuration and compiler-affecting KKT plugin identity.
  readonly appSrc: string;
  readonly filename: string;
  readonly context: RuleContext;
  readonly provesExternalRuntimeSource: (specifier: string, issuer: string) => boolean;
}

export const hasVerifiedCraTsxReachability = ({
  appSrc,
  filename,
  context,
  provesExternalRuntimeSource,
}: VerifiedTypedCraReachabilityInput): boolean => {
  if (!filename.endsWith(".tsx") || appSrc === filename || !isPathInside(filename, appSrc))
    return false;
  try {
    if (!isCanonicalPath(appSrc)) return false;
    const program = readPhysicalImplicitJsxProgram(context, filename);
    const entry = selectFile(
      TYPED_CRA_EXTENSIONS.map((extension) => path.join(appSrc, "index" + extension)),
    );
    if (!program || !entry) return false;

    const index = buildSourceProjectIndex({
      rootDirectory: appSrc,
      currentFilePath: filename,
      currentProgramNode: program,
      currentScopes: context.scopes,
      includeTestlikeSources: true,
      javascriptAllowsJsx: true,
      readTypedRuntimeEdge: createTypedEdgeReader(appSrc),
    });
    if (
      !index?.typedEdges ||
      index.hasOpaqueRuntimeConsumerSurface ||
      index.hasOpaqueMdxConsumerSurface
    ) {
      return false;
    }
    const closure = readSelectedTypedSourceClosure(index, [entry]);
    const { externalByIssuer } = index.typedEdges;
    return Boolean(
      closure?.reachable.has(filename) &&
      closure.opaqueIssuers.size === 0 &&
      [...closure.reachable].every((file) => {
        const external = externalByIssuer.get(file);
        if (
          external &&
          [...external].some((specifier) => !provesExternalRuntimeSource(specifier, file))
        ) {
          return false;
        }
        for (
          let directory = path.dirname(file);
          isPathInside(directory, appSrc);
          directory = path.dirname(directory)
        ) {
          if (readStat(path.join(directory, "package.json"))) return false;
        }
        return true;
      }),
    );
  } catch {
    return false;
  }
};
