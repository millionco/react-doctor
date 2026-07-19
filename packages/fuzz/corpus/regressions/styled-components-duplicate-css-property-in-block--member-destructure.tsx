import styled from "styled-components";

const Modal = styled.div`
  height: ${(properties) => (properties.active ? "100vh" : "auto")};
  height: ${({ active: enabled, ...rest }) => (enabled ? "100dvh" : "auto")};
`;
