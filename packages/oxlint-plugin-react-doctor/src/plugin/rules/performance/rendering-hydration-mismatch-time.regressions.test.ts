import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingHydrationMismatchTime } from "./rendering-hydration-mismatch-time.js";

const expectFail = (code: string): void => {
  const result = runRule(renderingHydrationMismatchTime, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(renderingHydrationMismatchTime, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("performance/rendering-hydration-mismatch-time — regressions", () => {
  it("does not flag Date.now() inside an event-handler arrow", () => {
    expectPass(`
      export const Row = () => (
        <button onClick={() => track(Date.now())}>Save</button>
      );
    `);
  });

  it("does not flag new Date() inside a function-expression handler body", () => {
    expectPass(`
      export const Field = () => (
        <input onChange={function handleChange() { setStamp(new Date()); }} />
      );
    `);
  });

  it("still flags a bare {Date.now()} child", () => {
    expectFail(`export const Stamp = () => <time>{Date.now()}</time>;`);
  });

  it("still flags chained new Date().toLocaleString()", () => {
    expectFail(`export const Banner = () => <span>{new Date().toLocaleString()}</span>;`);
  });

  it("still flags Math.random() reached through an attribute expression", () => {
    expectFail(`export const Tip = () => <p data-roll={String(Math.random())}>hi</p>;`);
  });

  it("does not flag the mined ant-design shape: Date.now() in a JSX attribute inside a jest test file", () => {
    const result = runRule(
      renderingHydrationMismatchTime,
      `export const Case = () => <Statistic.Timer type="countdown" value={Date.now() + 1500} />;`,
      { filename: "components/statistic/__tests__/index.test.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a story file either", () => {
    const result = runRule(
      renderingHydrationMismatchTime,
      `export const Demo = () => <time>{Date.now()}</time>;`,
      { filename: "src/components/clock.stories.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag new Date() inside JSX rendered by next/og ImageResponse", () => {
    expectPass(`
      import { ImageResponse } from "next/og";
      export async function GET() {
        return new ImageResponse(
          <div>
            <p>{formatDate(new Date())}</p>
          </div>,
        );
      }
    `);
  });

  it("does not flag Date.now() in an opengraph-image file", () => {
    const result = runRule(
      renderingHydrationMismatchTime,
      `export default function Image() {
        return <div>{Date.now()}</div>;
      }`,
      { filename: "app/blog/opengraph-image.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an IIFE returning new Date().toLocaleString()", () => {
    expectFail(`export const Banner = () => <span>{(() => new Date().toLocaleString())()}</span>;`);
  });

  it("still flags useMemo(() => Date.now(), []) inline in JSX", () => {
    expectFail(
      `import { useMemo } from "react"; export const Stamp = () => <time>{useMemo(() => Date.now(), [])}</time>;`,
    );
  });

  it("does not flag a useCallback handler factory inline in JSX", () => {
    expectPass(
      `export const Row = () => <button onClick={useCallback(() => track(Date.now()), [])}>go</button>;`,
    );
  });

  describe("unproven client-only flag guards", () => {
    it("flags new Date() behind a custom-hook result without local state provenance", () => {
      expectFail(`
        export const PointsBox = () => {
          const isClient = useClient();
          return (
            <div>
              {isClient && (
                <IconHeader title={\`Updated: \${format(new Date())}\`} />
              )}
            </div>
          );
        };
      `);
    });

    it("flags Date.now() behind a prop named isMounted", () => {
      expectFail(`
        export const Stamp = ({ isMounted }) => (
          <time>{isMounted ? Date.now() : null}</time>
        );
      `);
    });

    it("flags new Date() behind an unproven hasMounted value", () => {
      expectFail(`
        export const Clock = () => {
          const hasMounted = useHasMounted();
          if (hasMounted) {
            return <span>{new Date().toLocaleString()}</span>;
          }
          return null;
        };
      `);
    });

    it("still flags a guard whose flag is unrelated to mounting", () => {
      expectFail(`
        export const Banner = ({ isAdmin }) => (
          <div>{isAdmin && <span>{Date.now()}</span>}</div>
        );
      `);
    });
  });

  describe("falsy-initial useState gates", () => {
    it("does not flag new Date() inside JSX gated by a useState(false) flag", () => {
      expectPass(`
        import { useState } from "react";
        export const EventModal = () => {
          const [showRecurrenceEditor, setShowRecurrenceEditor] = useState(false);
          return (
            <div>
              {showRecurrenceEditor && (
                <RecurrenceEditor
                  eventStart={(() => {
                    const d = new Date(startDate);
                    return isNaN(d.getTime()) ? new Date() : d;
                  })()}
                />
              )}
            </div>
          );
        };
      `);
    });

    it("does not flag Date.now() inside JSX gated by a useState(null) toast", () => {
      expectPass(`
        import { useState } from "react";
        export const Panel = () => {
          const [undoToast, setUndoToast] = useState(null);
          return (
            <div>
              {undoToast && onMutate && (
                <span>{Math.ceil((undoToast.expiresAt - Date.now()) / 1000)}s</span>
              )}
            </div>
          );
        };
      `);
    });

    it("still flags when the gating state starts truthy", () => {
      expectFail(`
        import { useState } from "react";
        export const Panel = () => {
          const [visible, setVisible] = useState(true);
          return <div>{visible && <span>{Date.now()}</span>}</div>;
        };
      `);
    });

    it("still flags when the gate is a prop, not local state", () => {
      expectFail(`
        export const Banner = ({ open }) => (
          <div>{open && <span>{Date.now()}</span>}</div>
        );
      `);
    });
  });

  describe("copyright-year idiom", () => {
    it("does not flag new Date().getFullYear()", () => {
      expectPass(`
        export const Footer = () => (
          <footer>© {new Date().getFullYear()} Example</footer>
        );
      `);
    });

    it("still flags new Date().toLocaleDateString()", () => {
      expectFail(`export const Footer = () => <footer>{new Date().toLocaleDateString()}</footer>;`);
    });
  });

  describe("framer-motion transition config", () => {
    it("does not flag Math.random() inside a motion element's transition prop", () => {
      expectPass(`
        export const FloatingCard = () => (
          <motion.div
            animate={{ y: [0, -12, 0] }}
            transition={{ duration: 5 + Math.random() * 3, repeat: Infinity }}
          />
        );
      `);
    });

    it("still flags Math.random() in a motion element's initial prop", () => {
      expectFail(`
        export const FloatingCard = () => (
          <motion.div initial={{ opacity: Math.random() }} />
        );
      `);
    });

    it("still flags Math.random() in a transition prop on a non-motion element", () => {
      expectFail(`
        export const Card = () => <Widget transition={{ duration: Math.random() }} />;
      `);
    });
  });

  describe("email templates", () => {
    it("does not flag new Date().getFullYear() in an MJML email footer", () => {
      expectPass(`
        import { MjmlText } from "@faire/mjml-react";

        export default function Footer() {
          return <MjmlText>© {new Date().getFullYear()} Example</MjmlText>;
        }
      `);
    });

    it("does not flag time values in react-email components", () => {
      expectPass(`
        import { Text } from "@react-email/components";

        export const Footer = () => <Text>{new Date().getFullYear()}</Text>;
      `);
    });
  });

  describe("verdict-preserving receiver wrappers", () => {
    it("flags Date.now() through an as-any cast receiver", () => {
      expectFail(`export const Stamp = () => <time>{(Date as any).now()}</time>;`);
    });

    it("flags Math.random() through a non-null-asserted receiver", () => {
      expectFail(`export const Roll = () => <span>{(Math!).random()}</span>;`);
    });
  });

  describe("React Native packages", () => {
    let temporaryDirectory = "";

    beforeEach(() => {
      temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-hydration-rn-"));
    });

    afterEach(() => {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    it("does not flag new Date() in a react-native package (no hydration on mobile)", () => {
      const packageDirectory = fs.mkdtempSync(path.join(temporaryDirectory, "package-"));
      fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({ dependencies: { "react-native": "0.82.0" } }),
      );
      const result = runRule(
        renderingHydrationMismatchTime,
        `export const DatePickerField = () => <DateTimeInput maximumDate={new Date()} />;`,
        { filename: path.join(packageDirectory, "src", "DateTimeInput.tsx") },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });
  });
});
