// rule: styled-components-duplicate-css-property-in-block
// weakness: alias-guard
// source: PR #1341 Bugbot review

import { css } from "styled-components";

void css;

export const buildCssText = () => {
  const css = String.raw;
  return css`
    color: ${(properties) => (properties.$primary ? "blue" : "gray")};
    color: ${(properties) => (properties.$danger ? "red" : "black")};
  `;
};
