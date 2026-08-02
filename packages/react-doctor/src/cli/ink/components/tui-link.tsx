import Link from "ink-link";
import type { ReactNode } from "react";

export interface TuiLinkProps {
  readonly children: ReactNode;
  readonly url: string;
}

export const TuiLink = ({ children, url }: TuiLinkProps) => (
  <Link url={url} fallback={false}>
    {children}
  </Link>
);
