// rule: styled-components-duplicate-css-property-in-block
// weakness: alias-guard
// source: PR #1341 Bugbot review

import styled from "styled-components";

const isFullHeight = (properties: { $fullHeight: boolean }) => properties.$fullHeight;

export const Modal = styled.div`
  height: ${(properties) => (isFullHeight(properties) ? "100vh" : "auto")};
  height: ${(state) => (isFullHeight(state) ? "100dvh" : "auto")};
`;
