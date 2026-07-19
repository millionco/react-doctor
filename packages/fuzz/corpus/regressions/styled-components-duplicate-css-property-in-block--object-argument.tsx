import styled from "styled-components";

const Modal = styled.div`
  height: ${(properties) =>
    matches({ active: properties.active, values: [properties.value, ...properties.values] })
      ? "100vh"
      : "auto"};
  height: ${(state) =>
    matches({ active: state.active, values: [state.value, ...state.values] }) ? "100dvh" : "auto"};
`;
