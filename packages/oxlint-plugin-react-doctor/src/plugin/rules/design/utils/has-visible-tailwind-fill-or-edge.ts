const BORDER_WIDTH_PATTERN = /^border(?:-[trblxy])?(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const RING_WIDTH_PATTERN = /^ring(?:-(px|[\d.]+|\[[\d.]+px\]))?$/;
const SHADOW_GEOMETRY_PATTERN =
  /^shadow(?:-(?:2xl|inner|lg|md|sm|xl|xs)|-\[(?=[^\]]*(?:em|px|rem))[^\]]+\])?$/;
const NON_SURFACE_BACKGROUND_PATTERN =
  /^bg-(?:auto|center|clip-|contain|cover|fixed|left|local|none|origin-|repeat|right|scroll|top|transparent|\[(?:length|position|size):)/;
const BORDER_EDGE_NAMES = ["top", "right", "bottom", "left"];
const BORDER_EDGES_BY_DIRECTION = new Map([
  ["t", ["top"]],
  ["r", ["right"]],
  ["b", ["bottom"]],
  ["l", ["left"]],
  ["x", ["right", "left"]],
  ["y", ["top", "bottom"]],
]);

interface EffectiveBooleanState {
  isDeclared: boolean;
  isImportant: boolean;
  specificity: number;
  value: boolean | null;
}

interface TailwindTokenPriority {
  isImportant: boolean;
  utility: string;
}

const getTokenPriority = (token: string): TailwindTokenPriority => ({
  isImportant: token.startsWith("!"),
  utility: token.startsWith("!") ? token.slice(1) : token,
});

const updateState = (
  currentState: EffectiveBooleanState,
  value: boolean,
  isImportant: boolean,
  specificity = 0,
): EffectiveBooleanState => {
  if (!currentState.isDeclared) return { isDeclared: true, isImportant, specificity, value };
  if (currentState.isImportant !== isImportant) {
    return currentState.isImportant
      ? currentState
      : { isDeclared: true, isImportant, specificity, value };
  }
  if (currentState.specificity !== specificity) {
    return currentState.specificity > specificity
      ? currentState
      : { isDeclared: true, isImportant, specificity, value };
  }
  if (currentState.value === value) return currentState;
  return { ...currentState, value: null };
};

const makeState = (value: boolean): EffectiveBooleanState => ({
  isDeclared: false,
  isImportant: false,
  specificity: -1,
  value,
});

const hasPositiveLength = (token: string, pattern: RegExp): boolean => {
  const match = token.match(pattern);
  if (!match) return false;
  if (!match[1] || match[1] === "px") return true;
  return parseFloat(match[1].replace(/^\[|px\]$/g, "")) > 0;
};

const getAffectedBorderEdges = (direction: string | undefined): string[] =>
  direction ? (BORDER_EDGES_BY_DIRECTION.get(direction) ?? []) : BORDER_EDGE_NAMES;

const getBorderDirectionSpecificity = (direction: string | undefined): number =>
  direction ? (direction === "x" || direction === "y" ? 1 : 2) : 0;

const getVisibleTailwindBorderEdges = (tokens: string[]): Map<string, boolean> => {
  const makeStateByEdge = (value: boolean): Map<string, EffectiveBooleanState> =>
    new Map(BORDER_EDGE_NAMES.map((edgeName) => [edgeName, makeState(value)]));
  const widthByEdge = makeStateByEdge(false);
  const styleByEdge = makeStateByEdge(true);
  const colorByEdge = makeStateByEdge(true);
  const opacityByEdge = makeStateByEdge(true);

  for (const markedToken of tokens) {
    const { isImportant, utility: token } = getTokenPriority(markedToken);
    const widthMatch = token.match(
      /^border(?:-([trblxy]))?(?:-(px|\d+(?:\.\d+)?|\[\d+(?:\.\d+)?px\]))?$/,
    );
    if (widthMatch) {
      const hasWidth = hasPositiveLength(token, BORDER_WIDTH_PATTERN);
      const specificity = getBorderDirectionSpecificity(widthMatch[1]);
      for (const edgeName of getAffectedBorderEdges(widthMatch[1])) {
        const currentState = widthByEdge.get(edgeName);
        if (currentState)
          widthByEdge.set(edgeName, updateState(currentState, hasWidth, isImportant, specificity));
      }
      continue;
    }

    const styleMatch = token.match(
      /^border(?:-([trblxy]))?-(hidden|none|solid|dashed|dotted|double)$/,
    );
    if (styleMatch) {
      const hasVisibleStyle = styleMatch[2] !== "hidden" && styleMatch[2] !== "none";
      const specificity = getBorderDirectionSpecificity(styleMatch[1]);
      for (const edgeName of getAffectedBorderEdges(styleMatch[1])) {
        styleByEdge.set(
          edgeName,
          updateState(
            styleByEdge.get(edgeName) ?? makeState(true),
            hasVisibleStyle,
            isImportant,
            specificity,
          ),
        );
      }
      continue;
    }

    const colorMatch = token.match(/^border(?:-([trblxy]))?-(.+)$/);
    if (!colorMatch) continue;
    if (colorMatch[2].startsWith("opacity-")) {
      const hasVisibleOpacity = colorMatch[2] !== "opacity-0";
      const specificity = getBorderDirectionSpecificity(colorMatch[1]);
      for (const edgeName of getAffectedBorderEdges(colorMatch[1])) {
        opacityByEdge.set(
          edgeName,
          updateState(
            opacityByEdge.get(edgeName) ?? makeState(true),
            hasVisibleOpacity,
            isImportant,
            specificity,
          ),
        );
      }
      continue;
    }
    if (
      colorMatch[2].startsWith("spacing-") ||
      colorMatch[2] === "collapse" ||
      colorMatch[2] === "separate"
    ) {
      continue;
    }
    const hasVisibleColor = colorMatch[2] !== "transparent" && !colorMatch[2].endsWith("/0");
    const specificity = getBorderDirectionSpecificity(colorMatch[1]);
    for (const edgeName of getAffectedBorderEdges(colorMatch[1])) {
      colorByEdge.set(
        edgeName,
        updateState(
          colorByEdge.get(edgeName) ?? makeState(true),
          hasVisibleColor,
          isImportant,
          specificity,
        ),
      );
    }
  }

  return new Map(
    BORDER_EDGE_NAMES.map((edgeName) => [
      edgeName,
      Boolean(
        widthByEdge.get(edgeName)?.value &&
        styleByEdge.get(edgeName)?.value &&
        colorByEdge.get(edgeName)?.value &&
        opacityByEdge.get(edgeName)?.value,
      ),
    ]),
  );
};

export const hasVisibleTailwindBorder = (tokens: string[]): boolean =>
  [...getVisibleTailwindBorderEdges(tokens).values()].some(Boolean);

export const hasVisibleTailwindClosedBorder = (tokens: string[]): boolean =>
  [...getVisibleTailwindBorderEdges(tokens).values()].every(Boolean);

export const hasVisibleTailwindRing = (tokens: string[]): boolean => {
  let widthState = makeState(false);
  let colorState = makeState(true);
  let opacityState = makeState(true);
  for (const markedToken of tokens) {
    const { isImportant, utility: token } = getTokenPriority(markedToken);
    if (RING_WIDTH_PATTERN.test(token)) {
      widthState = updateState(
        widthState,
        hasPositiveLength(token, RING_WIDTH_PATTERN),
        isImportant,
      );
      continue;
    }
    if (token === "ring-opacity-0") {
      opacityState = updateState(opacityState, false, isImportant);
      continue;
    }
    if (token.startsWith("ring-opacity-")) {
      opacityState = updateState(opacityState, true, isImportant);
      continue;
    }
    if (token === "ring-transparent" || (token.startsWith("ring-") && token.endsWith("/0"))) {
      colorState = updateState(colorState, false, isImportant);
      continue;
    }
    if (
      token.startsWith("ring-") &&
      !token.startsWith("ring-opacity-") &&
      !token.startsWith("ring-offset-") &&
      token !== "ring-inset"
    ) {
      colorState = updateState(colorState, true, isImportant);
    }
  }
  return widthState.value === true && colorState.value === true && opacityState.value === true;
};

export const hasVisibleTailwindBackground = (tokens: string[]): boolean => {
  let colorState = makeState(false);
  let opacityState = makeState(true);
  for (const markedToken of tokens) {
    const { isImportant, utility: token } = getTokenPriority(markedToken);
    if (token.startsWith("bg-opacity-")) {
      opacityState = updateState(opacityState, token !== "bg-opacity-0", isImportant);
      continue;
    }
    if (
      token === "bg-transparent" ||
      (token.startsWith("bg-") && !NON_SURFACE_BACKGROUND_PATTERN.test(token))
    ) {
      colorState = updateState(
        colorState,
        !/^(?:bg-transparent|bg-\[transparent\]|bg-.+\/0)$/.test(token),
        isImportant,
      );
    }
  }
  return colorState.value === true && opacityState.value === true;
};

export const hasVisibleTailwindShadow = (tokens: string[]): boolean => {
  let geometryState = makeState(false);
  let colorState = makeState(true);
  for (const markedToken of tokens) {
    const { isImportant, utility: token } = getTokenPriority(markedToken);
    if (token === "shadow-none") {
      geometryState = updateState(geometryState, false, isImportant);
      continue;
    }
    if (SHADOW_GEOMETRY_PATTERN.test(token)) {
      geometryState = updateState(geometryState, true, isImportant);
      continue;
    }
    if (token === "shadow-transparent" || (token.startsWith("shadow-") && token.endsWith("/0"))) {
      colorState = updateState(colorState, false, isImportant);
      continue;
    }
    if (token.startsWith("shadow-")) colorState = updateState(colorState, true, isImportant);
  }
  return geometryState.value === true && colorState.value === true;
};

export const hasVisibleTailwindFillOrEdge = (tokens: string[]): boolean =>
  hasVisibleTailwindBorder(tokens) ||
  hasVisibleTailwindRing(tokens) ||
  hasVisibleTailwindBackground(tokens);

export const hasVisibleTailwindClosedSurface = (tokens: string[]): boolean =>
  hasVisibleTailwindClosedBorder(tokens) ||
  hasVisibleTailwindRing(tokens) ||
  hasVisibleTailwindBackground(tokens);

export const hasVisibleTailwindBoundary = (tokens: string[]): boolean =>
  hasVisibleTailwindBorder(tokens) ||
  hasVisibleTailwindRing(tokens) ||
  hasVisibleTailwindShadow(tokens);
