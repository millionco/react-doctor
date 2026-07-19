// rule: styled-components-non-transient-custom-prop-on-intrinsic-element
// weakness: name-heuristic
import styled from "styled-components";
export const Button = styled.button<{ onMagic: () => void }>``;
