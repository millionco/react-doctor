// rule: styled-components-duplicate-css-property-in-block
// source: PR #1341 Bugbot review

import styled, { css } from "styled-components";

const baseStyles = css`
  display: block;
`;

const styleBlock = css;

export const MixedButton = styled.button`
  ${baseStyles}
  color: ${(properties) => (properties.$primary ? "blue" : "gray")};
  color: ${(properties) => (properties.$danger ? "red" : "black")};
`;

export const NestedButton = styled.button`
  color: ${(properties) => (properties.$primary ? "blue" : "gray")}
  &:hover {
    opacity: 0.8;
  }
  color: ${(properties) => (properties.$danger ? "red" : "black")};
`;

export const SharedStyles = styleBlock`
  color: ${(properties) => (properties.$primary ? "blue" : "gray")};
  color: ${(properties) => (properties.$danger ? "red" : "black")};
`;
