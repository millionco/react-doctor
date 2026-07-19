import styled from "styled-components";

const Modal = styled.div`
  height: ${({ active }) => (active ? "100vh" : "auto")};
  height: ${({ active: enabled }) => (enabled ? "100dvh" : "auto")};
`;
