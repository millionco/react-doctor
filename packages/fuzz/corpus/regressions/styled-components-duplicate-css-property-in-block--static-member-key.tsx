// rule: styled-components-duplicate-css-property-in-block
// weakness: name-heuristic
// source: PR #1341 Bugbot review

import styled from "styled-components";

export const Modal = styled.div`
  height: ${(properties) => (properties.state ? "100vh" : "auto")};
  height: ${(state) => (state.state ? "100dvh" : "auto")};
`;
