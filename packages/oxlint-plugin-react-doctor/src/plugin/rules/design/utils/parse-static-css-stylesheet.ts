import { Features, transform } from "lightningcss";
import type {
  CalcFor_DimensionPercentageFor_LengthValue,
  Declaration,
  DimensionPercentageFor_LengthValue,
  Rule,
  Selector,
} from "lightningcss";

const TRACKED_CSS_PROPERTIES = new Set([
  "align-items",
  "align-self",
  "aspect-ratio",
  "display",
  "flex",
  "flex-direction",
  "flex-grow",
  "flex-wrap",
  "height",
  "width",
]);
const CONDITIONAL_CSS_RULE_TYPES: ReadonlySet<Rule["type"]> = new Set([
  "container",
  "media",
  "moz-document",
  "nesting",
  "scope",
  "starting-style",
  "supports",
]);

interface ParsedCssDeclaration {
  readonly property: string;
  readonly value: string;
}

export interface StaticCssDeclaration extends ParsedCssDeclaration {
  readonly declarationOrder: number;
  readonly isImportant: boolean;
}

export interface StaticCssRule {
  readonly cascadeLayerKey: string | null;
  readonly declarations: ReadonlyArray<StaticCssDeclaration>;
  readonly hasAnonymousCascadeLayer: boolean;
  readonly sourceOrder: number;
  readonly selectors: ReadonlyArray<Selector>;
}

export interface ParsedStaticCssStylesheets {
  readonly ambiguousProperties: ReadonlySet<string>;
  readonly ambiguousRules: ReadonlyArray<StaticCssRule>;
  readonly ruleCount: number;
  readonly rules: ReadonlyArray<StaticCssRule>;
}

const calculationContainsPercentage = (
  calculation: CalcFor_DimensionPercentageFor_LengthValue,
): boolean => {
  if (calculation.type === "value") {
    return dimensionPercentageContainsPercentage(calculation.value);
  }
  if (calculation.type === "number") return false;
  if (calculation.type === "sum") return calculation.value.some(calculationContainsPercentage);
  if (calculation.type === "product") {
    return calculationContainsPercentage(calculation.value[1]);
  }
  const mathFunction = calculation.value;
  if (mathFunction.type === "calc") return calculationContainsPercentage(mathFunction.value);
  if (mathFunction.type === "min" || mathFunction.type === "max") {
    return mathFunction.value.some(calculationContainsPercentage);
  }
  if (mathFunction.type === "clamp") {
    return mathFunction.value.some(calculationContainsPercentage);
  }
  return true;
};

const dimensionPercentageContainsPercentage = (
  value: DimensionPercentageFor_LengthValue,
): boolean => {
  if (value.type === "percentage") return true;
  if (value.type === "dimension") return false;
  return calculationContainsPercentage(value.value);
};

const serializeDimensionPercentage = (value: DimensionPercentageFor_LengthValue): string => {
  if (value.type === "dimension") return `${value.value.value}${value.value.unit}`;
  if (value.type === "percentage") return `${value.value * 100}%`;
  return dimensionPercentageContainsPercentage(value) ? "calc(1%)" : "calc(1px)";
};

const parseTrackedDeclaration = (declaration: Declaration): ParsedCssDeclaration | null => {
  if (declaration.property === "unparsed") {
    const property = declaration.value.propertyId.property;
    return TRACKED_CSS_PROPERTIES.has(property) ? { property, value: "ambiguous" } : null;
  }
  if (!TRACKED_CSS_PROPERTIES.has(declaration.property)) return null;
  if (declaration.property === "width" || declaration.property === "height") {
    const value =
      declaration.value.type === "length-percentage"
        ? serializeDimensionPercentage(declaration.value.value)
        : declaration.value.type;
    return { property: declaration.property, value };
  }
  if (declaration.property === "aspect-ratio") {
    const ratio = declaration.value.ratio;
    return {
      property: declaration.property,
      value: ratio ? `${declaration.value.auto ? "auto " : ""}${ratio[0]} / ${ratio[1]}` : "auto",
    };
  }
  if (declaration.property === "display") {
    const value =
      declaration.value.type === "keyword"
        ? declaration.value.value
        : declaration.value.inside.type === "flex" && declaration.value.outside === "block"
          ? "flex"
          : `${declaration.value.outside}-${declaration.value.inside.type}`;
    return { property: declaration.property, value };
  }
  if (declaration.property === "flex") {
    return { property: declaration.property, value: String(declaration.value.grow) };
  }
  if (declaration.property === "flex-grow") {
    return { property: declaration.property, value: String(declaration.value) };
  }
  if (declaration.property === "flex-direction" || declaration.property === "flex-wrap") {
    return { property: declaration.property, value: declaration.value };
  }
  if (declaration.property === "align-items" || declaration.property === "align-self") {
    return { property: declaration.property, value: declaration.value.type };
  }
  return null;
};

const parseDeclarations = (
  declarations: ReadonlyArray<Declaration>,
  importantDeclarations: ReadonlyArray<Declaration>,
): ReadonlyArray<StaticCssDeclaration> => {
  const parsedDeclarations: StaticCssDeclaration[] = [];
  const appendDeclarations = (
    declarationsToParse: ReadonlyArray<Declaration>,
    isImportant: boolean,
  ): void => {
    for (const declaration of declarationsToParse) {
      const parsedDeclaration = parseTrackedDeclaration(declaration);
      if (!parsedDeclaration) continue;
      parsedDeclarations.push({
        ...parsedDeclaration,
        declarationOrder: parsedDeclarations.length,
        isImportant,
      });
    }
  };
  appendDeclarations(declarations, false);
  appendDeclarations(importantDeclarations, true);
  return parsedDeclarations;
};

export const parseStaticCssStylesheet = (source: string): ParsedStaticCssStylesheets => {
  const ambiguousProperties = new Set<string>();
  const ambiguousRules: StaticCssRule[] = [];
  const rules: StaticCssRule[] = [];
  const cascadeLayerPathStack: string[][] = [];
  const hasAnonymousCascadeLayerStack: boolean[] = [];
  let anonymousCascadeLayerCount = 0;
  let cascadeLayerPath: string[] = [];
  let conditionalRuleDepth = 0;
  let hasAnonymousCascadeLayer = false;
  let ruleCount = 0;
  try {
    const nestingResult = transform({
      code: Buffer.from(source),
      errorRecovery: true,
      filename: "stylesheet.css",
      include: Features.Nesting,
    });
    const result = transform({
      code: nestingResult.code,
      errorRecovery: true,
      filename: "stylesheet.css",
      visitor: {
        Rule: (rule) => {
          if (CONDITIONAL_CSS_RULE_TYPES.has(rule.type)) conditionalRuleDepth += 1;
          if (rule.type === "layer-block") {
            cascadeLayerPathStack.push(cascadeLayerPath);
            hasAnonymousCascadeLayerStack.push(hasAnonymousCascadeLayer);
            if (rule.value.name) {
              cascadeLayerPath = [...cascadeLayerPath, ...rule.value.name];
            } else {
              cascadeLayerPath = [...cascadeLayerPath, `anonymous-${anonymousCascadeLayerCount}`];
              anonymousCascadeLayerCount += 1;
              hasAnonymousCascadeLayer = true;
            }
          }
          if (rule.type !== "style") return;
          const declarations = parseDeclarations(
            rule.value.declarations.declarations,
            rule.value.declarations.importantDeclarations,
          );
          if (declarations.length > 0) {
            const targetRules = conditionalRuleDepth > 0 ? ambiguousRules : rules;
            targetRules.push({
              cascadeLayerKey:
                cascadeLayerPath.length > 0 ? JSON.stringify(cascadeLayerPath) : null,
              declarations,
              hasAnonymousCascadeLayer,
              selectors: rule.value.selectors,
              sourceOrder: ruleCount,
            });
          }
          ruleCount += 1;
        },
        RuleExit: (rule) => {
          if (rule.type === "layer-block") {
            cascadeLayerPath = cascadeLayerPathStack.pop() ?? [];
            hasAnonymousCascadeLayer = hasAnonymousCascadeLayerStack.pop() ?? false;
          }
          if (CONDITIONAL_CSS_RULE_TYPES.has(rule.type)) conditionalRuleDepth -= 1;
        },
      },
    });
    if (nestingResult.warnings.length > 0 || result.warnings.length > 0) {
      for (const property of TRACKED_CSS_PROPERTIES) ambiguousProperties.add(property);
    }
  } catch {
    for (const property of TRACKED_CSS_PROPERTIES) ambiguousProperties.add(property);
  }
  return { ambiguousProperties, ambiguousRules, ruleCount, rules };
};
