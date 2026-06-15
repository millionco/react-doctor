import {
  ELEMENT_TYPE_CLASS,
  ELEMENT_TYPE_FORWARD_REF,
  ELEMENT_TYPE_FUNCTION,
  ELEMENT_TYPE_MEMO,
  ELEMENT_TYPE_VIRTUAL,
  FORGET_WRAPPER_PREFIX,
} from "../constants.js";

export interface ParsedElementDisplayName {
  formattedDisplayName: string | null;
  hocDisplayNames: Array<string> | null;
  compiledWithForget: boolean;
}

const isCompositeType = (type: number): boolean =>
  type === ELEMENT_TYPE_CLASS ||
  type === ELEMENT_TYPE_FORWARD_REF ||
  type === ELEMENT_TYPE_FUNCTION ||
  type === ELEMENT_TYPE_MEMO ||
  type === ELEMENT_TYPE_VIRTUAL;

/**
 * Port of React DevTools' `parseElementDisplayNameFromBackend`: unwraps the
 * `Forget(...)` compiler marker and splits HOC wrappers (`withRouter(Foo)` →
 * name `Foo`, hocs `["withRouter"]`).
 */
export const parseElementDisplayName = (
  displayName: string | null,
  type: number,
): ParsedElementDisplayName => {
  if (displayName === null) {
    return { formattedDisplayName: null, hocDisplayNames: null, compiledWithForget: false };
  }

  if (displayName.startsWith(FORGET_WRAPPER_PREFIX)) {
    const unwrapped = displayName.slice(FORGET_WRAPPER_PREFIX.length, displayName.length - 1);
    const inner = parseElementDisplayName(unwrapped, type);
    return {
      formattedDisplayName: inner.formattedDisplayName,
      hocDisplayNames: inner.hocDisplayNames,
      compiledWithForget: true,
    };
  }

  if (isCompositeType(type) && displayName.includes("(")) {
    const matches = displayName.match(/[^()]+/g);
    if (matches !== null) {
      return {
        formattedDisplayName: matches[matches.length - 1] ?? displayName,
        hocDisplayNames: matches.slice(0, -1),
        compiledWithForget: false,
      };
    }
  }

  return { formattedDisplayName: displayName, hocDisplayNames: null, compiledWithForget: false };
};
