// rule: styled-components-non-transient-custom-prop-on-intrinsic-element
// weakness: alias-guard
import styled from "styled-components";

interface InteractiveProps {
  active: boolean;
}

interface ButtonProps extends InteractiveProps {
  disabled?: boolean;
}

export const Button = styled.button<ButtonProps>``;
