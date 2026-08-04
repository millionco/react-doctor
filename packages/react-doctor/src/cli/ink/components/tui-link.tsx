import { Text, Transform } from "ink";
import type { ReactNode } from "react";
import { formatHyperlink } from "../../utils/format-hyperlink.js";
import { supportsHyperlinks } from "../../utils/supports-hyperlinks.js";

export interface TuiLinkProps {
  readonly children: ReactNode;
  readonly url: string;
}

export const TuiLink = ({ children, url }: TuiLinkProps) => {
  const shouldFormatHyperlink = supportsHyperlinks();
  return (
    <Transform transform={(text) => (shouldFormatHyperlink ? formatHyperlink(text, url) : text)}>
      <Text>{children}</Text>
    </Transform>
  );
};
