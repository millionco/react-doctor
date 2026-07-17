import styled from "styled-components";

const Modal = styled.div`
  height: ${({ active: value }) => (value ? "100vh" : "auto")};
  height: ${({ disabled: value }) => (value ? "100dvh" : "auto")};
`;
