// rule: styled-components-non-transient-custom-prop-on-intrinsic-element
// weakness: wrapper-transparency
// source: react-bench corpus audit 2026-07 (suomifi HtmlA: the only local usage destructures the custom prop away before spreading onto the styled intrinsic)
import * as React from "react";
import styled from "styled-components";

interface HtmlAWithRefProps {
  children: React.ReactNode;
  forwardedRef?: React.Ref<HTMLAnchorElement>;
}

const Ahref = styled.a<HtmlAWithRefProps>`
  color: red;
`;

export const HtmlA = ({ forwardedRef, ...passProps }: HtmlAWithRefProps) => (
  <Ahref ref={forwardedRef} {...passProps} />
);
