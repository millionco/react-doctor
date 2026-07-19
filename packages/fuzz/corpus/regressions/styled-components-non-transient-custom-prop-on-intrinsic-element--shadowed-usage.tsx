// rule: styled-components-non-transient-custom-prop-on-intrinsic-element
// weakness: alias-guard
// source: adversarial audit of render/data-safety rules
import styled from "styled-components";
const _Surface = styled.div<{ custom: boolean }>``;
export const Example = () => {
  const _Surface = OtherSurface;
  return <_Surface custom />;
};
