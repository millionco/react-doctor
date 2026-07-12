// rule: no-polymorphic-children
// weakness: library-idiom
// source: react-bench write-react-callstackincubator-rozenite-279

import type { HTMLProps, ReactNode } from "react";

interface CodeBlockProps extends HTMLProps<HTMLPreElement> {
  children?: ReactNode;
}

const VirtualizedCode = ({ text }: { text: string }) => <code>{text.slice(0, 100)}</code>;

export const CodeBlock = ({ children, ...preProps }: CodeBlockProps) => {
  if (typeof children === "string" && children.length > 50_000) {
    return <VirtualizedCode text={children} />;
  }
  return <pre {...preProps}>{children}</pre>;
};
