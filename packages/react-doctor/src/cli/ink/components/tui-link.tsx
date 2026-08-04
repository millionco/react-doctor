import { Text, Transform } from "ink";
import type { ReactNode } from "react";
import terminalLink from "terminal-link";

export interface TuiLinkProps {
  readonly children: ReactNode;
  readonly url: string;
}

export const TuiLink = ({ children, url }: TuiLinkProps) => (
  <Transform transform={(text) => terminalLink(text, url, { fallback: false })}>
    <Text>{children}</Text>
  </Transform>
);
