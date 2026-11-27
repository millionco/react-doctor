import * as fs from "node:fs";
import * as path from "node:path";
import { defaultTreeAdapter, html, parse } from "parse5";
import type { DefaultTreeAdapterTypes } from "parse5";
import { recordContentProbe } from "./cross-file-probe-recorder.js";
import { isPathInside } from "./is-path-inside.js";
import { normalizeFilename } from "./normalize-filename.js";
import { resolveModulePath } from "./resolve-module-path.js";

interface ProjectHtmlScripts {
  readonly inlinePrograms: ReadonlyArray<string>;
  readonly localEntrypoints: ReadonlyArray<string>;
}

const JAVASCRIPT_TYPES = new Set([
  "",
  "module",
  "text/javascript",
  "application/javascript",
  "text/ecmascript",
  "application/ecmascript",
]);
const DATA_SCRIPT_TYPES = new Set(["application/ld+json", "application/json", "speculationrules"]);
const URL_BASE = "https://react-doctor.invalid";

const isExternalHttpUrl = (value: string): boolean => {
  if (!/^(?:https?:)?\/\//iu.test(value)) return false;
  try {
    const url = new URL(value, URL_BASE);
    return url.origin !== URL_BASE && (url.protocol === "https:" || url.protocol === "http:");
  } catch {
    return false;
  }
};

const isSystemImportMap = (value: string): boolean => {
  try {
    const data: unknown = JSON.parse(value);
    if (
      !data ||
      typeof data !== "object" ||
      Array.isArray(data) ||
      Object.keys(data).length !== 1 ||
      !("imports" in data)
    )
      return false;
    const imports = data.imports;
    if (!imports || typeof imports !== "object" || Array.isArray(imports)) return false;
    return Object.values(imports).every((entry) => typeof entry === "string");
  } catch {
    return false;
  }
};

const resolveHtmlScriptAddress = (
  rootDirectory: string,
  filename: string,
  address: string,
  resolveLocalEntrypoint?: (fromFilename: string, specifier: string) => string | null,
): string | null => {
  try {
    const relativeFile = normalizeFilename(path.relative(rootDirectory, filename));
    const base = new URL(relativeFile.split("/").map(encodeURIComponent).join("/"), URL_BASE + "/");
    const url = new URL(address, base);
    if (url.origin !== URL_BASE || url.search || url.hash) return null;
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("\\") || pathname.includes("\0")) return null;
    const absolutePath = path.resolve(rootDirectory, "." + pathname);
    if (!isPathInside(absolutePath, rootDirectory)) return null;
    if (resolveLocalEntrypoint) return resolveLocalEntrypoint(filename, address);
    return resolveModulePath(
      filename,
      "./" + normalizeFilename(path.relative(path.dirname(filename), absolutePath)),
    );
  } catch {
    return null;
  }
};

const getText = (element: DefaultTreeAdapterTypes.Element): string =>
  element.childNodes
    .filter(defaultTreeAdapter.isTextNode)
    .map((node) => node.value)
    .join("");

interface ReadProjectHtmlScriptsOptions {
  readonly onlyLocalModuleScripts?: boolean;
  readonly rejectHtmlTemplates?: boolean;
  readonly externalLocalModulesOnly?: boolean;
  // The callback receives the original validated HTML address so an active
  // resolver can apply aliases before local path normalization.
  readonly resolveLocalEntrypoint?: (fromFilename: string, specifier: string) => string | null;
  readonly readSource?: (filename: string) => string | null;
}

export const readProjectHtmlScripts = (
  rootDirectory: string,
  filename: string,
  options: ReadProjectHtmlScriptsOptions = {},
): ProjectHtmlScripts | null => {
  let root: DefaultTreeAdapterTypes.Document;
  try {
    recordContentProbe(filename);
    const source = options.readSource
      ? options.readSource(filename)
      : fs.readFileSync(filename, "utf8");
    if (source === null) return null;
    root = parse(source);
  } catch {
    return null;
  }
  const inlinePrograms: string[] = [];
  const localEntrypoints: string[] = [];
  const pending = [...root.childNodes];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || !defaultTreeAdapter.isElementNode(current)) continue;
    const attr = (name: string) => current.attrs.find((item) => item.name === name)?.value;
    if ((current.tagName === "base" && attr("href") !== undefined) || attr("srcdoc") !== undefined)
      return null;
    for (const attribute of current.attrs) {
      if (attribute.name.startsWith("on"))
        inlinePrograms.push(`function eventHandler() {\n${attribute.value}\n}`);
      if (/^javascript:/iu.test(attribute.value.trim()) && !attribute.name.startsWith("on"))
        return null;
    }
    if (current.tagName === "template" && current.namespaceURI === html.NS.HTML) {
      if (options.rejectHtmlTemplates) return null;
      pending.push(
        ...defaultTreeAdapter.getTemplateContent(current as DefaultTreeAdapterTypes.Template)
          .childNodes,
      );
    }
    if (current.tagName !== "script") {
      pending.push(...current.childNodes);
      continue;
    }
    if (current.namespaceURI !== html.NS.HTML) return null;
    const type = (attr("type") ?? "").trim().toLowerCase();
    const source = attr("src") ?? attr("href");
    const content = getText(current);
    if (
      options.onlyLocalModuleScripts &&
      (attr("type") !== "module" ||
        attr("src") === undefined ||
        !source ||
        source.includes("%") ||
        content.trim() ||
        isExternalHttpUrl(source))
    ) {
      return null;
    }
    if (options.externalLocalModulesOnly) {
      if (type === "module") {
        if (
          attr("type") !== "module" ||
          attr("src") === undefined ||
          !source ||
          source.includes("%") ||
          content.trim() ||
          isExternalHttpUrl(source)
        )
          return null;
      } else if (source !== undefined && !isExternalHttpUrl(source)) return null;
    }
    if (type === "importmap") return null;
    if (type === "systemjs-importmap") {
      // SystemJS maps do not change native module resolution. The project index
      // rejects a SystemJS runtime edge when it finds a loader.
      if (source !== undefined || !isSystemImportMap(content)) return null;
      continue;
    }
    if (DATA_SCRIPT_TYPES.has(type)) continue;
    if (!JAVASCRIPT_TYPES.has(type) || attr("language") !== undefined) return null;
    if (source === undefined) {
      if (content.trim()) inlinePrograms.push(content);
      continue;
    }
    if (/(?:^|\/)system(?:js(?:[/@]|$)|(?:\.min)?\.js(?:[?#]|$))/iu.test(source)) return null;
    if (isExternalHttpUrl(source)) continue;
    const resolved = resolveHtmlScriptAddress(
      rootDirectory,
      filename,
      source,
      options.resolveLocalEntrypoint,
    );
    if (!resolved) return null;
    localEntrypoints.push(normalizeFilename(resolved));
  }
  return { inlinePrograms, localEntrypoints };
};
