// rule: styled-components-duplicate-css-property-in-block
// source: PR #1341 Bugbot review

import styled from "styled-components";

export const Modal = styled.div`
  height: ${(properties) => (properties.compact ? "50vh" : "auto")} !important;
  height: ${(properties) => (properties.full ? "100vh" : "auto")};
  height: ${(properties) => (properties.full ? "100dvh" : "auto")} !important;
`;
