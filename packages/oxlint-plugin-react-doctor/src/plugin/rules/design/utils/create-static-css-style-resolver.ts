import * as fs from "node:fs";
import * as path from "node:path";
import { CROSS_FILE_PARSE_MAX_BYTES } from "../../../constants/thresholds.js";
import { recordContentProbe } from "../../../utils/cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import {
  selectorListMatches,
  selectorMatchesRootTarget,
  StaticSelectorMatch,
} from "./match-static-css-selector.js";
import {
  parseStaticCssStylesheet,
  type ParsedStaticCssStylesheets,
  type StaticCssRule,
} from "./parse-static-css-stylesheet.js";

const REACT_ROOT_HEIGHT_TARGETS: ReadonlyArray<"body" | "html" | "root"> = ["html", "body", "root"];
const STATIC_CSS_IMPORT_PATTERN =
  /(?:^|[;\n])\s*import\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+\.css(?:[?#][^"']*)?)["']/gm;

export interface StaticCssStyle {
  readonly ambiguousProperties: ReadonlySet<string>;
  readonly valuesByProperty: ReadonlyMap<string, ReadonlyArray<string>>;
}

export interface StaticCssStyleResolver {
  readonly hasDefiniteReactRootHeight: boolean;
  readonly resolve: (node: EsTreeNodeOfType<"JSXOpeningElement">) => StaticCssStyle;
}

const addAmbiguousDeclarations = (
  declarations: ReadonlyMap<string, ReadonlyArray<string>>,
  ambiguousProperties: Set<string>,
): void => {
  for (const property of declarations.keys()) ambiguousProperties.add(property);
};

const ruleCanMatchRootTarget = (
  rule: StaticCssRule,
  target: "body" | "html" | "root",
  expectedMatch: StaticSelectorMatch,
): boolean =>
  rule.declarations.has("height") &&
  rule.selectors.some((selector) => {
    const result = selectorMatchesRootTarget(selector, target);
    return result.hasTargetAnchor && result.match === expectedMatch;
  });

const stylesheetsHaveDefiniteReactRootHeight = (
  stylesheets: ParsedStaticCssStylesheets,
): boolean => {
  if (stylesheets.ambiguousProperties.has("height")) return false;
  return REACT_ROOT_HEIGHT_TARGETS.every((target) => {
    if (
      [...stylesheets.rules, ...stylesheets.ambiguousRules].some((rule) =>
        ruleCanMatchRootTarget(rule, target, StaticSelectorMatch.Ambiguous),
      ) ||
      stylesheets.ambiguousRules.some((rule) =>
        ruleCanMatchRootTarget(rule, target, StaticSelectorMatch.Match),
      )
    ) {
      return false;
    }
    const values = stylesheets.rules.flatMap((rule) =>
      ruleCanMatchRootTarget(rule, target, StaticSelectorMatch.Match)
        ? (rule.declarations.get("height") ?? [])
        : [],
    );
    return values.length > 0 && values.every((value) => value === "100%");
  });
};

const findImportedSiblingStylesheetPaths = (filename: string): ReadonlySet<string> => {
  const importedStylesheetPaths = new Set<string>();
  const directoryPath = path.dirname(filename);
  try {
    const fileStat = fs.statSync(filename);
    if (fileStat.size > CROSS_FILE_PARSE_MAX_BYTES) return importedStylesheetPaths;
    const source = fs.readFileSync(filename, "utf8");
    for (const match of source.matchAll(STATIC_CSS_IMPORT_PATTERN)) {
      const importSource = match[1].split(/[?#]/, 1)[0];
      if (!importSource.startsWith(".")) continue;
      const stylesheetPath = path.resolve(directoryPath, importSource);
      if (path.dirname(stylesheetPath) === directoryPath)
        importedStylesheetPaths.add(stylesheetPath);
    }
  } catch {}
  return importedStylesheetPaths;
};

const loadSiblingStylesheets = (filename: string): ParsedStaticCssStylesheets => {
  const rules: StaticCssRule[] = [];
  const ambiguousRules: StaticCssRule[] = [];
  const ambiguousProperties = new Set<string>();
  for (const stylesheetPath of findImportedSiblingStylesheetPaths(filename)) {
    recordContentProbe(stylesheetPath);
    try {
      const fileStat = fs.statSync(stylesheetPath);
      if (fileStat.size > CROSS_FILE_PARSE_MAX_BYTES) continue;
      const parsed = parseStaticCssStylesheet(fs.readFileSync(stylesheetPath, "utf8"));
      rules.push(...parsed.rules);
      ambiguousRules.push(...parsed.ambiguousRules);
      for (const property of parsed.ambiguousProperties) ambiguousProperties.add(property);
    } catch {}
  }
  return { ambiguousProperties, ambiguousRules, rules };
};

export const createStaticCssStyleResolver = (
  filename: string | undefined,
): StaticCssStyleResolver => {
  let stylesheets: ParsedStaticCssStylesheets | null = null;
  const getStylesheets = (): ParsedStaticCssStylesheets => {
    stylesheets ??=
      filename && path.isAbsolute(filename)
        ? loadSiblingStylesheets(filename)
        : { ambiguousProperties: new Set(), ambiguousRules: [], rules: [] };
    return stylesheets;
  };
  return {
    get hasDefiniteReactRootHeight() {
      return stylesheetsHaveDefiniteReactRootHeight(getStylesheets());
    },
    resolve: (node) => {
      if (!filename || !path.isAbsolute(filename)) {
        return { ambiguousProperties: new Set(), valuesByProperty: new Map() };
      }
      const loadedStylesheets = getStylesheets();
      const valuesByProperty = new Map<string, string[]>();
      const ambiguousProperties = new Set(loadedStylesheets.ambiguousProperties);
      for (const rule of loadedStylesheets.rules) {
        const match = selectorListMatches(rule.selectors, node);
        if (match === StaticSelectorMatch.Ambiguous) {
          addAmbiguousDeclarations(rule.declarations, ambiguousProperties);
        } else if (match === StaticSelectorMatch.Match) {
          for (const [property, ruleValues] of rule.declarations) {
            const values = valuesByProperty.get(property) ?? [];
            values.push(...ruleValues);
            valuesByProperty.set(property, values);
          }
        }
      }
      for (const rule of loadedStylesheets.ambiguousRules) {
        if (selectorListMatches(rule.selectors, node) === StaticSelectorMatch.NoMatch) continue;
        addAmbiguousDeclarations(rule.declarations, ambiguousProperties);
      }
      return { ambiguousProperties, valuesByProperty };
    },
  };
};
