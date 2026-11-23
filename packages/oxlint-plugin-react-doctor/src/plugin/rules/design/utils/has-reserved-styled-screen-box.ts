export interface StyledScreenBoxFragment {
  readonly source: string;
  readonly minWidthPx: number;
  readonly maxWidthPx: number;
}

interface StyledScreenBoxDeclaration {
  readonly property: string;
  readonly value: string;
}

interface StyledScreenBoxRule extends StyledScreenBoxFragment {
  readonly declarations: ReadonlyArray<StyledScreenBoxDeclaration>;
}

const parseDeclarations = (source: string): StyledScreenBoxDeclaration[] | null => {
  const declarations: StyledScreenBoxDeclaration[] = [];
  const parts = source.trim().split(";");
  if (parts.pop()?.trim()) return null;
  for (const part of parts) {
    const match = /^\s*([a-z-]+)\s*:\s*([a-z0-9.%]+)\s*$/i.exec(part);
    if (!match?.[1] || !match[2]) return null;
    declarations.push({ property: match[1].toLowerCase(), value: match[2].toLowerCase() });
  }
  return declarations;
};

const isPositivePixelLength = (value: string): boolean =>
  /^(?:\d*\.)?\d+px$/.test(value) &&
  Number(value.slice(0, -2)) > 0 &&
  Number.isFinite(Number(value.slice(0, -2)));

const isSupportedBoxDeclaration = ({ property, value }: StyledScreenBoxDeclaration): boolean => {
  if (property === "display") return value === "none" || value === "block";
  if (property === "flex-shrink") return value === "0";
  return ["width", "height", "margin-right"].includes(property) && isPositivePixelLength(value);
};

export const hasReservedStyledScreenBox = (
  fragments: ReadonlyArray<StyledScreenBoxFragment>,
): boolean => {
  const rules: StyledScreenBoxRule[] = [];
  let hasImageWidthBound = false;
  let hasImageHeightBound = false;
  for (const fragment of fragments) {
    let source = fragment.source;
    if (/[^\t\n\f\r\x20-\x7e]/.test(source) || source.includes("\\")) return false;
    if (source.includes("{")) {
      if (fragment.minWidthPx !== 0 || fragment.maxWidthPx !== Infinity) return false;
      const imageRule = /&\s+img\s*\{([^{}]*)\}/.exec(source);
      if (!imageRule?.[1]) return false;
      const declarations = parseDeclarations(imageRule[1]);
      if (!declarations?.length) return false;
      if (!parseDeclarations(source.slice(0, imageRule.index))) return false;
      for (const { property, value } of declarations) {
        if (value !== "100%") return false;
        if (property === "max-width") hasImageWidthBound = true;
        else if (property === "max-height") hasImageHeightBound = true;
        else return false;
      }
      source = source.replace(imageRule[0], "");
    }
    if (!source.trim()) continue;
    const declarations = parseDeclarations(source);
    if (!declarations || !declarations.every(isSupportedBoxDeclaration)) return false;
    rules.push({ ...fragment, declarations });
  }
  if (!hasImageWidthBound || !hasImageHeightBound) return false;
  const endpoints = [
    ...new Set([0, ...rules.flatMap((rule) => [rule.minWidthPx, rule.maxWidthPx])]),
  ]
    .filter(Number.isFinite)
    .sort((first, second) => first - second);
  return endpoints.every((lower, index) => {
    const upper = endpoints[index + 1] ?? Infinity;
    return [lower, upper].every((cellUpper) => {
      const properties = new Map<string, string>([["display", "block"]]);
      for (const rule of rules) {
        if (rule.minWidthPx > lower || rule.maxWidthPx < cellUpper) continue;
        for (const declaration of rule.declarations) {
          properties.set(declaration.property, declaration.value);
        }
      }
      return (
        properties.get("display") === "none" ||
        (properties.get("display") === "block" &&
          properties.has("width") &&
          properties.has("height") &&
          properties.get("flex-shrink") === "0")
      );
    });
  });
};
