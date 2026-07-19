import styled from "styled-components";

const _Button = styled.button`
  content: "${(properties) => (properties.$primary ? "primary" : "default")}";
  content: "${(properties) => (properties.$danger ? "danger" : "default")}";
`;
