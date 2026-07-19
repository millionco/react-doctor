import styled from "styled-components";

const Modal = styled.div`
  height: ${(properties) => (matches({ 1: properties.active }) ? "100vh" : "auto")};
  height: ${(state) => (matches({ 2: state.active }) ? "100dvh" : "auto")};
`;
