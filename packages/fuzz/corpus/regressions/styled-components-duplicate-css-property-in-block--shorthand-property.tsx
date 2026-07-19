import styled from "styled-components";

const active = true;
const Modal = styled.div`
  height: ${() => (matches({ active }) ? "100vh" : "auto")};
  height: ${() => (matches({ active: active }) ? "100dvh" : "auto")};
`;
