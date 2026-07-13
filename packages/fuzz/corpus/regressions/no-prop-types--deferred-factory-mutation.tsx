// rule: no-prop-types
// weakness: control-flow
// source: adversarial review of component receiver provenance

import styled from "styled-components";

const mutateStyled = () => {
  styled.div = (parts: TemplateStringsArray) => ({ parts });
};
setTimeout(mutateStyled, 0);
const Panel = styled.div`
  color: red;
`;
Panel.propTypes = { value: () => true };
