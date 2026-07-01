import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { styledStaticZeroArgArrowInterpolation } from "./styled-static-zero-arg-arrow-interpolation.js";

const STYLED_IMPORT = `import styled, { css, keyframes } from 'styled-components';`;

describe("styled-static-zero-arg-arrow-interpolation", () => {
  it("flags a zero-arg arrow returning a static css block", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      const Box = styled.div\`
        color: red;
        \${() => css\`width: 100px;\`}
      \`;
    `
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a zero-arg arrow returning a static string", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      const Box = styled.div\`
        display: \${() => 'flex'};
      \`;
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a zero-arg arrow referencing only import-bound constants", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      import { BRAND_CART_WIDTH_WIDE } from './constants';
      const Cart = styled.div\`
        \${() => css\`width: \${BRAND_CART_WIDTH_WIDE.large};\`}
      \`;
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inside styled(Component) and keyframes tags", () => {
    const styledComponent = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      import { Base } from './base';
      const Box = styled(Base)\`opacity: \${() => 0.5};\`;
    `
    );
    const keyframesTag = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      const spin = keyframes\`from { top: \${() => '0px'}; }\`;
    `
    );
    expect(styledComponent.diagnostics).toHaveLength(1);
    expect(keyframesTag.diagnostics).toHaveLength(1);
  });

  it("does not flag an arrow taking props/theme", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      const Box = styled.div\`
        \${({ $size }) => css\`width: \${$size}px;\`}
      \`;
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a zero-arg arrow calling a function", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      const Box = styled.div\`
        margin: \${() => getSpacing(2)};
      \`;
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a zero-arg arrow with a call in a conditional", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      const Box = styled.div\`
        color: \${() => (isLoggedInRetailer() ? 'blue' : 'gray')};
      \`;
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the module-const deferral idiom (TDZ / circular import)", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      ${STYLED_IMPORT}
      const baseCardStyles = css\`padding: 8px;\`;
      const Card = styled.div\`
        \${() => baseCardStyles}
      \`;
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag interpolations in a non-styled tagged template", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      import { gql } from '@apollo/client';
      const query = gql\`query { \${() => 'field'} }\`;
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when styled is a local shadow, not the styled-components import", () => {
    const result = runRule(
      styledStaticZeroArgArrowInterpolation,
      `
      const styled = { div: (s) => s };
      const Box = styled.div\`color: \${() => 'red'};\`;
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
