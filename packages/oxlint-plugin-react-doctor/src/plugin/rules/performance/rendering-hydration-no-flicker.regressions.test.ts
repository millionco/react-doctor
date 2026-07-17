import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingHydrationNoFlicker } from "./rendering-hydration-no-flicker.js";

const expectFail = (code: string): void => {
  const result = runRule(renderingHydrationNoFlicker, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(renderingHydrationNoFlicker, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("performance/rendering-hydration-no-flicker — regressions", () => {
  it("does not flag a mount effect that measures a ref's DOM node", () => {
    expectPass(`
      const Resizer = () => {
        const resizerToggleRef = useRef(null);
        const [headerCellWidth, setHeaderCellWidth] = useState(0);
        useEffect(() => {
          setHeaderCellWidth(getHeaderWidth(resizerToggleRef.current));
        }, []);
        return <button ref={resizerToggleRef} aria-label={String(headerCellWidth)} />;
      };
    `);
  });

  it("does not flag a setter whose state only feeds id/aria attributes", () => {
    expectPass(`
      const Pagination = ({ totalPages }) => {
        const [descriptionId, setDescriptionId] = useState(undefined);
        useEffect(() => {
          setDescriptionId(\`Pagination-totalPage-\${uidGenerator()}\`);
        }, []);
        return (
          <div>
            <input aria-describedby={descriptionId} />
            <span id={descriptionId}>{\` of \${totalPages} pages\`}</span>
          </div>
        );
      };
    `);
  });

  it("still flags the classic setIsClient(true) mount flag", () => {
    expectFail(`
      const useClient = () => {
        const [isClient, setIsClient] = useState(false);
        useEffect(() => {
          setIsClient(true);
        }, []);
        return isClient;
      };
    `);
  });

  it("still flags a portal hidden until the client mount effect runs", () => {
    expectFail(`
      import { createPortal } from "react-dom";
      import { useEffect, useState } from "react";
      const Gallery = ({ show }) => {
        const [isClient, setIsClient] = useState(false);
        useEffect(() => {
          setIsClient(true);
        }, []);
        if (!show || !isClient) {
          return null;
        }
        return createPortal(<div role="dialog" />, document.body);
      };
    `);
  });

  it("still flags a media capability gate deferred until after paint", () => {
    expectFail(`
      import { useEffect, useMemo, useState } from "react";
      const Background = ({ mime, src }) => {
        const [hasMounted, setHasMounted] = useState(false);
        useEffect(() => {
          setHasMounted(true);
        }, []);
        const isPlayable = useMemo(
          () => Boolean(hasMounted && document.createElement("video").canPlayType(mime)),
          [hasMounted, mime],
        );
        return isPlayable ? <video src={src} /> : <img src={src} />;
      };
    `);
  });

  it("still flags a setter feeding visible content", () => {
    expectFail(`
      const NoteForm = () => {
        const [placeholder, setPlaceholder] = useState("");
        useEffect(() => {
          setPlaceholder(getRandomPlaceholder());
        }, []);
        return <textarea placeholder={placeholder} />;
      };
    `);
  });

  it("still flags a localStorage-backed setter", () => {
    expectFail(`
      const Toolbar = () => {
        const [hasUnseenWhatsNew, setHasUnseenWhatsNew] = useState(false);
        useEffect(() => {
          setHasUnseenWhatsNew(localStorage.getItem("whats-new") !== VERSION);
        }, []);
        return <button data-badge={hasUnseenWhatsNew} />;
      };
    `);
  });

  // The SSR-safe timezone/locale adoption pattern (the fix that
  // no-locale-format-in-render recommends) must not be re-flagged as a
  // flicker: the value cannot be produced during render without a
  // hydration mismatch, so the post-mount flash is the correct trade.
  it("does not flag a setter adopting the browser timezone via Intl", () => {
    expectPass(`
      const Clock = ({ utcTime }) => {
        const [zone, setZone] = useState("UTC");
        useEffect(() => {
          setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
        }, []);
        return <time>{utcTime} {zone}</time>;
      };
    `);
  });

  it("does not flag a setter formatting with the browser locale post-mount", () => {
    expectPass(`
      const Timestamp = ({ value }) => {
        const [label, setLabel] = useState("");
        useEffect(() => {
          setLabel(new Date(value).toLocaleString());
        }, []);
        return <time>{label}</time>;
      };
    `);
  });

  it("does not flag a setter adopting navigator.language post-mount", () => {
    expectPass(`
      const Greeting = () => {
        const [language, setLanguage] = useState("en");
        useEffect(() => {
          setLanguage(navigator.language);
        }, []);
        return <span>{language}</span>;
      };
    `);
  });

  it("still flags when a no-op statement pads the mount effect", () => {
    expectFail(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [isClient, setIsClient] = useState(false);
        useEffect(() => { void 0;
          setIsClient(true);
        }, []);
        return <div>{isClient ? "client" : "server"}</div>;
      };
    `);
  });

  it("stays silent when the second statement is a real side effect", () => {
    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [isClient, setIsClient] = useState(false);
        useEffect(() => {
          reportMount();
          setIsClient(true);
        }, []);
        return <div>{isClient ? "client" : "server"}</div>;
      };
    `);
  });
});
