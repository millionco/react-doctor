import styled from "styled-components";

const Modal = styled.div`
  height: ${(properties) =>
    (properties.compact ? properties.small : properties.large) ? "100vh" : "auto"};
  height: ${(state) => ((state.compact ? state.small : state.large) ? "100dvh" : "auto")};
`;
