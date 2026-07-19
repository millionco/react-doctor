import styled from "styled-components";

const _DifferentDefaults = styled.div`
  height: ${({ active = true }) => (active ? "100vh" : "auto")};
  height: ${({ active = false }) => (active ? "100dvh" : "auto")};
`;

const _DifferentLocals = styled.div`
  height: ${(properties) => {
    const active = properties.first;
    return active ? "100vh" : "auto";
  }};
  height: ${(properties) => {
    const active = properties.second;
    return active ? "100dvh" : "auto";
  }};
`;
