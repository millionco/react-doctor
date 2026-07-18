import fs from "node:fs";
import path from "node:path";
import { listSourceFiles } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";

interface CreateDiagnosticEvidenceReaderOptions {
  readonly resolveForwardedHandlers?: boolean;
}

interface DiagnosticEvidenceReaderState {
  readonly sourceByFilePath: Map<string, string | null>;
  readonly aliasesByComponentName: Map<string, ReadonlyMap<string, string>>;
  componentCallsitePaths: ReadonlyMap<string, ReadonlySet<string>> | null;
}

const readSource = (
  rootDirectory: string,
  filePath: string,
  sourceByFilePath: Map<string, string | null>,
): string | null => {
  if (sourceByFilePath.has(filePath)) return sourceByFilePath.get(filePath) ?? null;
  try {
    const source = fs.readFileSync(path.resolve(rootDirectory, filePath), "utf-8");
    sourceByFilePath.set(filePath, source);
    return source;
  } catch {
    sourceByFilePath.set(filePath, null);
    return null;
  }
};

const getEnclosingComponentName = (source: string, diagnostic: Diagnostic): string | null => {
  const sourceBeforeDiagnostic = source
    .split(/\r?\n/)
    .slice(0, diagnostic.line - 1)
    .join("\n");
  const componentPattern = /\bfunction\s+([A-Z][\w$]*)\b[^{]*\{/g;
  let componentName: string | null = null;
  for (const match of sourceBeforeDiagnostic.matchAll(componentPattern)) {
    const functionSource = sourceBeforeDiagnostic.slice(match.index);
    const openingBraceCount = functionSource.match(/\{/g)?.length ?? 0;
    const closingBraceCount = functionSource.match(/\}/g)?.length ?? 0;
    if (openingBraceCount > closingBraceCount) componentName = match[1] ?? null;
  }
  return componentName;
};

const resolveForwardingCallback = (source: string, bindingName: string): string => {
  const callbackPattern = new RegExp(
    `\\bconst\\s+${bindingName}\\s*=\\s*(?:useCallback\\s*\\()?[^=;]*=>\\s*\\{?\\s*(?:return\\s+|void\\s+)?([A-Za-z_$][\\w$]*)\\s*\\(`,
  );
  return source.match(callbackPattern)?.[1] ?? bindingName;
};

const buildComponentCallsitePaths = (
  rootDirectory: string,
  sourceByFilePath: Map<string, string | null>,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const pathsByComponentName = new Map<string, Set<string>>();
  for (const filePath of listSourceFiles(rootDirectory)) {
    const source = readSource(rootDirectory, filePath, sourceByFilePath);
    if (source === null) continue;
    for (const match of source.matchAll(/<([A-Z][\w$]*)\b/g)) {
      const componentName = match[1];
      if (componentName === undefined) continue;
      const matchingPaths = pathsByComponentName.get(componentName) ?? new Set<string>();
      matchingPaths.add(filePath);
      pathsByComponentName.set(componentName, matchingPaths);
    }
  }
  return pathsByComponentName;
};

const getForwardedHandlerAliases = (
  rootDirectory: string,
  source: string,
  diagnostic: Diagnostic,
  state: DiagnosticEvidenceReaderState,
): ReadonlyMap<string, string> => {
  const componentName = getEnclosingComponentName(source, diagnostic);
  if (componentName === null) return new Map();
  const cachedAliases = state.aliasesByComponentName.get(componentName);
  if (cachedAliases !== undefined) return cachedAliases;

  state.componentCallsitePaths ??= buildComponentCallsitePaths(
    rootDirectory,
    state.sourceByFilePath,
  );
  const bindingsByPropName = new Map<string, Set<string>>();
  const unresolvedPropNames = new Set<string>();
  const componentPattern = new RegExp(`<${componentName}\\b[\\s\\S]*?>`, "g");
  const propPattern = /\b(on[A-Z]\w*)\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  const propNamePattern = /\b(on[A-Z]\w*)\s*=/g;
  for (const callsitePath of state.componentCallsitePaths.get(componentName) ?? []) {
    const callsiteSource = readSource(rootDirectory, callsitePath, state.sourceByFilePath);
    if (callsiteSource === null) continue;
    for (const componentMatch of callsiteSource.matchAll(componentPattern)) {
      const componentCallsite = componentMatch[0];
      const resolvedPropNames = new Set<string>();
      for (const propMatch of componentCallsite.matchAll(propPattern)) {
        const propName = propMatch[1];
        const bindingName = propMatch[2];
        if (propName === undefined || bindingName === undefined) continue;
        resolvedPropNames.add(propName);
        const bindings = bindingsByPropName.get(propName) ?? new Set<string>();
        bindings.add(resolveForwardingCallback(callsiteSource, bindingName));
        bindingsByPropName.set(propName, bindings);
      }
      for (const propNameMatch of componentCallsite.matchAll(propNamePattern)) {
        const propName = propNameMatch[1];
        if (propName !== undefined && !resolvedPropNames.has(propName)) {
          unresolvedPropNames.add(propName);
        }
      }
    }
  }

  const aliases = new Map<string, string>();
  for (const [propName, bindings] of bindingsByPropName) {
    if (bindings.size !== 1 || unresolvedPropNames.has(propName)) continue;
    const [bindingName] = bindings;
    if (bindingName !== undefined) aliases.set(propName, bindingName);
  }
  state.aliasesByComponentName.set(componentName, aliases);
  return aliases;
};

const normalizeForwardedHandlers = (
  evidence: string,
  aliases: ReadonlyMap<string, string>,
): string => {
  let normalizedEvidence = evidence;
  for (const [propName, bindingName] of aliases) {
    normalizedEvidence = normalizedEvidence
      .replace(new RegExp(`\\{\\s*${propName}\\s*\\}`, "g"), `{${bindingName}}`)
      .replace(new RegExp(`=>\\s*${propName}\\s*\\(`, "g"), `=> ${bindingName}(`);
  }
  return normalizedEvidence;
};

export const createDiagnosticEvidenceReader = (
  rootDirectory: string,
  options: CreateDiagnosticEvidenceReaderOptions = {},
): ((diagnostic: Diagnostic) => string | null) => {
  const state: DiagnosticEvidenceReaderState = {
    sourceByFilePath: new Map(),
    aliasesByComponentName: new Map(),
    componentCallsitePaths: null,
  };

  return (diagnostic) => {
    const source = readSource(rootDirectory, diagnostic.filePath, state.sourceByFilePath);
    if (source === null || !Number.isInteger(diagnostic.line)) return null;
    const sourceLines = source.split(/\r?\n/);
    const startLineIndex = Math.max(0, diagnostic.line - 1);
    const endLineIndex = Math.max(startLineIndex, (diagnostic.endLine ?? diagnostic.line) - 1);
    const evidence = sourceLines.slice(startLineIndex, endLineIndex + 1).join("\n");
    if (!options.resolveForwardedHandlers || !/\bon[A-Z]\w*\b/.test(evidence)) return evidence;
    return normalizeForwardedHandlers(
      evidence,
      getForwardedHandlerAliases(rootDirectory, source, diagnostic, state),
    );
  };
};
