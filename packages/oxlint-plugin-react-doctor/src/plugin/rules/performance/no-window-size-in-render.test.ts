import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noWindowSizeInRender } from "./no-window-size-in-render.js";

describe("no-window-size-in-render", () => {
  it("flags window.innerWidth in an arrow component body", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      const Banner = () => {
        const width = window.innerWidth - 32;
        return <img width={width} />;
      };
    `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags window.innerHeight branching JSX", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      const Hero = () => {
        const tall = window.innerHeight > 800;
        return tall ? <Big /> : <Small />;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a viewport read in a custom hook body", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      function useCols() {
        const cols = window.innerWidth > 1024 ? 3 : 1;
        return cols;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags window.screen.width in a component body", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      function Card() {
        const w = window.screen.width;
        return <div data-w={w} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a viewport read inside a .map render callback", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      const Grid = ({ items }) => (
        <Row>{items.map((i) => <Cell key={i.id} w={window.innerWidth / 2} />)}</Row>
      );
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags globalThis.innerWidth", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      const Banner = () => {
        const w = globalThis.innerWidth;
        return <img width={w} />;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a useState lazy initializer", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      import { useState, useEffect } from "react";
      function Resizable() {
        const [w, setW] = useState(() => window.innerWidth);
        useEffect(() => {
          const onResize = () => setW(window.innerWidth);
          window.addEventListener('resize', onResize);
          return () => window.removeEventListener('resize', onResize);
        }, []);
        return <div style={{ width: w }} />;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read inside an event handler", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      const Btn = () => {
        const onClick = () => console.log(window.innerWidth);
        return <button onClick={onClick} />;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a read inside useCallback", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      import { useRef, useCallback } from "react";
      const Comp = () => {
        const ref = useRef(null);
        const measure = useCallback(() => window.innerHeight, []);
        return <div ref={ref} onScroll={measure} />;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a module-scope read", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      const INITIAL = typeof window !== 'undefined' ? window.innerWidth : 0;
      const Comp = () => <div data-w={INITIAL} />;
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a lowercase helper function", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      function calc() {
        return window.innerWidth;
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a shadowed local window binding", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      const Comp = () => {
        const window = getStubWindow();
        const w = window.innerWidth;
        return <div data-w={w} />;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a useViewport hook call", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      import { useViewport } from "./hooks";
      const Comp = () => {
        const { width } = useViewport();
        return <div data-w={width} />;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag unrelated prop reads", () => {
    const result = runRule(
      noWindowSizeInRender,
      `
      const Comp = (props) => {
        const w = props.width ?? 100;
        return <div style={{ width: w }} />;
      };
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
