import * as fs from "node:fs";
import * as path from "node:path";
import type { Selector } from "lightningcss";
import { CROSS_FILE_PARSE_MAX_BYTES } from "../../../constants/thresholds.js";
import { recordContentProbe } from "../../../utils/cross-file-probe-recorder.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { compareStaticCssSelectorSpecificity } from "./compare-static-css-selector-specificity.js";
import {
  getStaticCssSelectorSpecificity,
  type StaticCssSelectorSpecificity,
} from "./get-static-css-selector-specificity.js";
import {
  selectorMatches,
  selectorMatchesRootTarget,
  StaticSelectorMatch,
} from "./match-static-css-selector.js";
import {
  parseStaticCssStylesheet,
  type ParsedStaticCssStylesheets,
  type StaticCssDeclaration,
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

interface MatchedCssDeclaration {
  readonly cascadeLayerKey: string | null;
  readonly declaration: StaticCssDeclaration;
  readonly sourceOrder: number;
  readonly specificity: StaticCssSelectorSpecificity;
}

interface CssCascadeResolution {
  readonly isAmbiguous: boolean;
  readonly value: string | null;
}

const addAmbiguousDeclarations = (
  declarations: ReadonlyArray<StaticCssDeclaration>,
  ambiguousProperties: Set<string>,
): void => {
  for (const declaration of declarations) ambiguousProperties.add(declaration.property);
};

const compareMatchedDeclarations = (
  leftCandidate: MatchedCssDeclaration,
  rightCandidate: MatchedCssDeclaration,
): number =>
  compareStaticCssSelectorSpecificity(leftCandidate.specificity, rightCandidate.specificity) ||
  leftCandidate.sourceOrder - rightCandidate.sourceOrder ||
  leftCandidate.declaration.declarationOrder - rightCandidate.declaration.declarationOrder;

const resolveCascade = (candidates: ReadonlyArray<MatchedCssDeclaration>): CssCascadeResolution => {
  if (candidates.length === 0) return { isAmbiguous: false, value: null };
  const hasImportantCandidate = candidates.some((candidate) => candidate.declaration.isImportant);
  let eligibleCandidates = candidates.filter(
    (candidate) => candidate.declaration.isImportant === hasImportantCandidate,
  );
  const hasLayeredCandidate = eligibleCandidates.some(
    (candidate) => candidate.cascadeLayerKey !== null,
  );
  const hasUnlayeredCandidate = eligibleCandidates.some(
    (candidate) => candidate.cascadeLayerKey === null,
  );
  const shouldUseLayeredCandidates = hasImportantCandidate
    ? hasLayeredCandidate
    : !hasUnlayeredCandidate;
  eligibleCandidates = eligibleCandidates.filter(
    (candidate) => (candidate.cascadeLayerKey !== null) === shouldUseLayeredCandidates,
  );
  if (
    eligibleCandidates[0]?.cascadeLayerKey !== null &&
    new Set(eligibleCandidates.map((candidate) => candidate.cascadeLayerKey)).size > 1 &&
    new Set(eligibleCandidates.map((candidate) => candidate.declaration.value)).size > 1
  ) {
    return { isAmbiguous: true, value: null };
  }
  const winner = eligibleCandidates.reduce((winningCandidate, candidate) =>
    compareMatchedDeclarations(candidate, winningCandidate) > 0 ? candidate : winningCandidate,
  );
  return { isAmbiguous: false, value: winner.declaration.value };
};

const resolveStylesheets = (
  stylesheets: ParsedStaticCssStylesheets,
  getSelectorMatch: (selector: Selector) => StaticSelectorMatch,
): StaticCssStyle => {
  const ambiguousProperties = new Set(stylesheets.ambiguousProperties);
  const candidatesByProperty = new Map<string, MatchedCssDeclaration[]>();
  for (const rule of stylesheets.rules) {
    let ambiguousSpecificity: StaticCssSelectorSpecificity | null = null;
    let matchingSpecificity: StaticCssSelectorSpecificity | null = null;
    for (const selector of rule.selectors) {
      const match = getSelectorMatch(selector);
      const specificity = getStaticCssSelectorSpecificity(selector);
      if (match === StaticSelectorMatch.Ambiguous) {
        if (
          ambiguousSpecificity === null ||
          compareStaticCssSelectorSpecificity(specificity, ambiguousSpecificity) > 0
        ) {
          ambiguousSpecificity = specificity;
        }
      } else if (match === StaticSelectorMatch.Match) {
        if (
          matchingSpecificity === null ||
          compareStaticCssSelectorSpecificity(specificity, matchingSpecificity) > 0
        ) {
          matchingSpecificity = specificity;
        }
      }
    }
    if (
      ambiguousSpecificity &&
      (!matchingSpecificity ||
        compareStaticCssSelectorSpecificity(ambiguousSpecificity, matchingSpecificity) > 0)
    ) {
      addAmbiguousDeclarations(rule.declarations, ambiguousProperties);
    }
    if (matchingSpecificity === null) continue;
    for (const declaration of rule.declarations) {
      const candidates = candidatesByProperty.get(declaration.property) ?? [];
      candidates.push({
        cascadeLayerKey: rule.cascadeLayerKey,
        declaration,
        sourceOrder: rule.sourceOrder,
        specificity: matchingSpecificity,
      });
      candidatesByProperty.set(declaration.property, candidates);
    }
  }
  for (const rule of stylesheets.ambiguousRules) {
    if (
      rule.selectors.every((selector) => getSelectorMatch(selector) === StaticSelectorMatch.NoMatch)
    ) {
      continue;
    }
    addAmbiguousDeclarations(rule.declarations, ambiguousProperties);
  }
  const valuesByProperty = new Map<string, ReadonlyArray<string>>();
  for (const [property, candidates] of candidatesByProperty) {
    const resolution = resolveCascade(candidates);
    if (resolution.isAmbiguous) ambiguousProperties.add(property);
    else if (resolution.value !== null) valuesByProperty.set(property, [resolution.value]);
  }
  return { ambiguousProperties, valuesByProperty };
};

const stylesheetsHaveDefiniteReactRootHeight = (stylesheets: ParsedStaticCssStylesheets): boolean =>
  REACT_ROOT_HEIGHT_TARGETS.every((target) => {
    const style = resolveStylesheets(
      stylesheets,
      (selector) => selectorMatchesRootTarget(selector, target).match,
    );
    const values = style.valuesByProperty.get("height") ?? [];
    return (
      !style.ambiguousProperties.has("height") &&
      values.length > 0 &&
      values.every((value) => value === "100%")
    );
  });

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

const offsetStylesheetRule = (rule: StaticCssRule, sourceOrderOffset: number): StaticCssRule => {
  const cascadeLayerKey =
    rule.cascadeLayerKey && rule.hasAnonymousCascadeLayer
      ? `${sourceOrderOffset}:${rule.cascadeLayerKey}`
      : rule.cascadeLayerKey;
  return {
    ...rule,
    cascadeLayerKey,
    sourceOrder: rule.sourceOrder + sourceOrderOffset,
  };
};

const loadSiblingStylesheets = (filename: string): ParsedStaticCssStylesheets => {
  const rules: StaticCssRule[] = [];
  const ambiguousRules: StaticCssRule[] = [];
  const ambiguousProperties = new Set<string>();
  let ruleCount = 0;
  for (const stylesheetPath of findImportedSiblingStylesheetPaths(filename)) {
    recordContentProbe(stylesheetPath);
    try {
      const fileStat = fs.statSync(stylesheetPath);
      if (fileStat.size > CROSS_FILE_PARSE_MAX_BYTES) continue;
      const parsed = parseStaticCssStylesheet(fs.readFileSync(stylesheetPath, "utf8"));
      rules.push(...parsed.rules.map((rule) => offsetStylesheetRule(rule, ruleCount)));
      ambiguousRules.push(
        ...parsed.ambiguousRules.map((rule) => offsetStylesheetRule(rule, ruleCount)),
      );
      ruleCount += parsed.ruleCount;
      for (const property of parsed.ambiguousProperties) ambiguousProperties.add(property);
    } catch {}
  }
  return { ambiguousProperties, ambiguousRules, ruleCount, rules };
};

export const createStaticCssStyleResolver = (
  filename: string | undefined,
): StaticCssStyleResolver => {
  let stylesheets: ParsedStaticCssStylesheets | null = null;
  const getStylesheets = (): ParsedStaticCssStylesheets => {
    stylesheets ??=
      filename && path.isAbsolute(filename)
        ? loadSiblingStylesheets(filename)
        : { ambiguousProperties: new Set(), ambiguousRules: [], ruleCount: 0, rules: [] };
    return stylesheets;
  };
  return {
    get hasDefiniteReactRootHeight() {
      return stylesheetsHaveDefiniteReactRootHeight(getStylesheets());
    },
    resolve: (node) =>
      resolveStylesheets(getStylesheets(), (selector) => selectorMatches(selector, node)),
  };
};
