// rule: dangerous-html-sink
// weakness: control-flow
// source: React Bench Datastoria audit review

import katex from "katex";

interface MathPreviewProps {
  options: object;
  value: string;
}

export const MathPreview = ({ options, value }: MathPreviewProps) => (
  <>
    <span
      dangerouslySetInnerHTML={{
        // eslint-disable-next-line no-constant-binary-expression
        __html: false && katex.renderToString(value, options),
      }}
    />
    <span
      dangerouslySetInnerHTML={{
        // eslint-disable-next-line no-constant-condition
        __html: (true ? "ready" : katex.renderToString(value, options)) ?? "",
      }}
    />
  </>
);
