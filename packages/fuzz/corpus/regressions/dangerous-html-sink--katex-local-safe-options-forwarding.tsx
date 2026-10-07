// rule: dangerous-html-sink
// weakness: default-parameter
// source: React Bench Datastoria audit review

import katex from "katex";

const renderMath = (value: string, options: object = { throwOnError: false }): string =>
  katex.renderToString(value, options);

const renderWithDependentDefault = (
  value: string,
  baseOptions: object,
  options: object = baseOptions,
): string => katex.renderToString(value, options);

const renderWithDestructuredDefault = (
  value: string,
  { options = { trust: false } }: { options?: object } = {},
): string => katex.renderToString(value, options);

export const MathPreview = ({ value }: { value: string }) => (
  <>
    <span dangerouslySetInnerHTML={{ __html: renderMath(value) }} />
    <span
      dangerouslySetInnerHTML={{
        __html: renderWithDependentDefault(value, { trust: false }),
      }}
    />
    <span dangerouslySetInnerHTML={{ __html: renderWithDestructuredDefault(value, {}) }} />
  </>
);
