// rule: styled-components-duplicate-css-property-in-block
// weakness: wrapper-transparency
// source: PR #1341 Bugbot review

import styled from "styled-components";

const fallbackProperties = { $fullHeight: false };

export const Modal = styled.div`
  height: ${(properties = fallbackProperties) => (properties.$fullHeight ? "100vh" : "auto")};
  height: ${(state) => (state.$fullHeight ? "100dvh" : "auto")};
`;
