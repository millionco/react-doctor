import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPolymorphicChildren } from "./no-polymorphic-children.js";

// docs-validation 2026-07: the doc flags components that BRANCH THEIR
// RENDER SHAPE on `typeof children`; pure normalization/derivation —
// label fallbacks, markdown source strings, clsx toggles — renders
// children identically either way and must stay silent.
describe("correctness/no-polymorphic-children — regressions", () => {
  it("stays silent on a label-fallback derivation (PortOS FieldLabel shape)", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      function FieldLabel({ htmlFor, children, field, locked, onToggleLock }) {
        return (
          <div>
            <label htmlFor={htmlFor}>{children}</label>
            <LockButton label={typeof children === 'string' ? children : field} locked={locked} />
          </div>
        );
      }
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on string normalization feeding a processor (lobe-ui CachedMarkdown shape)", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const CachedMarkdown = ({ children }) => {
        const file = new VFile();
        file.value = typeof children === 'string' ? children : '';
        return post(processor.runSync(processor.parse(file), file));
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a prop-fallback normalization (semiotic CodeBlock shape)", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const CodeBlock = ({ code, children }) => {
        code = code || (typeof children === 'string' ? children : '');
        return <Highlight source={code}>{children}</Highlight>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a clsx class toggle (cloudscape congratulation-screen shape)", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const CongratulationScreen = ({ children }) => (
        <div
          className={clsx({
            description: true,
            plaintext: typeof children === 'string',
          })}
        >
          {children}
        </div>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an editable-text derivation (antd Typography shape)", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const Base = ({ children, editConfig, onEditChange }) => (
        <Editable
          value={editConfig.text ?? (typeof children === 'string' ? children : '')}
          onSave={onEditChange}
        />
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a backwards-compatible pre renderer virtualizes only large strings", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const CodeBlock = ({ children, ...preProps }) => {
        if (typeof children === 'string' && children.length > 50_000) {
          return <VirtualizedCode text={children} />;
        }
        return <pre {...preProps}>{children}</pre>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a module constant defines the large-string threshold", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const VIRTUALIZATION_THRESHOLD = 50_000;

      const CodeBlock = ({ children, ...preProps }) => {
        if (typeof children === 'string' && children.length > VIRTUALIZATION_THRESHOLD) {
          return <VirtualizedCode text={children} />;
        }
        return <pre {...preProps}>{children}</pre>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for aliased, wrapped, and commuted large-string guards", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const MINIMUM_VIRTUALIZED_LENGTH = 50_000 as const;
      const VIRTUALIZATION_THRESHOLD = MINIMUM_VIRTUALIZED_LENGTH;

      const CodeBlock = ({ children }) => {
        if ('string' === typeof children && VIRTUALIZATION_THRESHOLD < children.length) {
          return <VirtualizedCode text={children} />;
        }
        return <pre>{children}</pre>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for the negated fallback form of a large-string guard", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const VIRTUALIZATION_THRESHOLD = 50_000;

      const CodeBlock = ({ children }) => {
        if (typeof children !== 'string' || children.length <= VIRTUALIZATION_THRESHOLD) {
          return <pre>{children}</pre>;
        }
        return <VirtualizedCode text={children} />;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a helper narrows large strings before rendering", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const VIRTUALIZATION_THRESHOLD = 50_000;
      const getVirtualizableText = (content) =>
        typeof content === 'string' && content.length > VIRTUALIZATION_THRESHOLD
          ? content
          : null;

      const CodeBlock = ({ children }) => {
        const virtualizableText = getVirtualizableText(children);
        if (virtualizableText !== null) {
          return <VirtualizedCode text={virtualizableText} />;
        }
        return <pre>{children}</pre>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a small module-constant threshold", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const WIDE_LABEL_THRESHOLD = 3;

      const Button = ({ children }) => {
        if (typeof children === 'string' && children.length > WIDE_LABEL_THRESHOLD) {
          return <button className="wide">{children}</button>;
        }
        return <div className="compact">{children}</div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags mutable and unknown thresholds", () => {
    const mutableResult = runRule(
      noPolymorphicChildren,
      `
      let threshold = 50_000;
      threshold = 3;

      const Button = ({ children }) => {
        if (typeof children === 'string' && children.length > threshold) {
          return <button className="wide">{children}</button>;
        }
        return <div className="compact">{children}</div>;
      };
      `,
    );
    const unknownResult = runRule(
      noPolymorphicChildren,
      `
      const Button = ({ children, threshold }) => {
        if (typeof children === 'string' && children.length > threshold) {
          return <button className="wide">{children}</button>;
        }
        return <div className="compact">{children}</div>;
      };
      `,
    );
    const importedResult = runRule(
      noPolymorphicChildren,
      `
      import { VIRTUALIZATION_THRESHOLD } from './config';

      const Button = ({ children }) => {
        if (typeof children === 'string' && children.length > VIRTUALIZATION_THRESHOLD) {
          return <button className="wide">{children}</button>;
        }
        return <div className="compact">{children}</div>;
      };
      `,
    );
    const memberResult = runRule(
      noPolymorphicChildren,
      `
      const config = { virtualizationThreshold: 50_000 };

      const Button = ({ children }) => {
        if (typeof children === 'string' && children.length > config.virtualizationThreshold) {
          return <button className="wide">{children}</button>;
        }
        return <div className="compact">{children}</div>;
      };
      `,
    );
    expect(mutableResult.parseErrors).toEqual([]);
    expect(mutableResult.diagnostics).toHaveLength(1);
    expect(unknownResult.parseErrors).toEqual([]);
    expect(unknownResult.diagnostics).toHaveLength(1);
    expect(importedResult.parseErrors).toEqual([]);
    expect(importedResult.diagnostics).toHaveLength(1);
    expect(memberResult.parseErrors).toEqual([]);
    expect(memberResult.diagnostics).toHaveLength(1);
  });

  it("stays silent when a leading guard precedes large-string virtualization", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const CodeBlock = ({ enabled, children }) => {
        if (enabled && typeof children === 'string' && children.length > 50_000) {
          return <VirtualizedCode text={children} />;
        }
        return <pre>{children}</pre>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the large-string length comparison is parenthesized", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const CodeBlock = ({ children }) => {
        if (typeof children === 'string' && (children.length > 50_000)) {
          return <VirtualizedCode text={children} />;
        }
        return <pre>{children}</pre>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags small-string branches that change layout semantics", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const Button = ({ children }) => {
        if (typeof children === 'string' && children.length > 3) {
          return <button className="wide">{children}</button>;
        }
        return <div className="compact">{children}</div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a ternary that renders different shapes", () => {
    const result = runRule(
      noPolymorphicChildren,
      `const Button = ({ children }) =>
        typeof children === "string" ? <span>{children}</span> : <div>{children}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an early return that changes render shape", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const Card = ({ children }) => {
        if (typeof children === 'string') {
          return <p className="card-text">{children}</p>;
        }
        return <div className="card-body">{children}</div>;
      };
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an `&&` guard that renders a wrapped shape", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const Label = ({ children }) => (
        <div>{typeof children === 'string' && <span className="text">{children}</span>}</div>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a cloneElement branch (render shape changes without JSX literals)", () => {
    const result = runRule(
      noPolymorphicChildren,
      `
      const Slot = ({ children }) =>
        typeof children === 'string' ? children : cloneElement(children, { slot: true });
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
