import styled from "styled-components";

const _FlattenedFallback = styled.div`
  color: ${(properties) => (properties.primary ? "red" : "blue")};
  color: ${(properties) => (properties.secondary ? "green" : undefined)};
`;

const _ImportantFallback = styled.div`
  color: ${(properties) => (properties.primary ? "red" : "blue")} !important;
  color: ${(properties) => (properties.secondary ? "green" : "black")};
`;
