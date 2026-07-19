import styled from "styled-components";

const _Modal = styled.div`
  height: ${(properties) => (/full/i.test(properties.mode) ? "100vh" : "auto")};
  height: ${(state) => (/full/i.test(state.mode) ? "100dvh" : "auto")};
`;
