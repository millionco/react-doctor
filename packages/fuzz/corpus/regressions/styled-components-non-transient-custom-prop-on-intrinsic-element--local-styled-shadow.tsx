// rule: styled-components-non-transient-custom-prop-on-intrinsic-element
// weakness: name-heuristic
// source: adversarial audit 2026-07
const styled = makeTemplateFactory();

export const LocalTemplate = styled.div<{ active: boolean }>`
  color: red;
`;
