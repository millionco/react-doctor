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
  it("flags immediate viewport adoption alongside resize subscription setup", () => {
    expectFail(`
      import { useEffect, useState } from "react";
      const ReactTransliterate = ({ hideOnMobile, breakpoint }) => {
        const [windowWidth, setWindowWidth] = useState(0);
        const shouldRenderSuggestions = hideOnMobile ? windowWidth > breakpoint : true;
        useEffect(() => {
          const handleResize = () => {
            setWindowWidth(window.innerWidth);
          };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => {
            window.removeEventListener("resize", handleResize);
          };
        }, []);
        return shouldRenderSuggestions ? <Suggestions /> : null;
      };
    `);
  });

  it("flags expression-bodied viewport handlers and cleanup", () => {
    expectFail(`
      import { useEffect, useState } from "react";
      const ResponsiveSuggestions = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        useEffect(() => {
          const handleResize = () => setWindowWidth(window.innerWidth);
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => window.removeEventListener("resize", handleResize);
        }, []);
        return windowWidth > 500 ? <Suggestions /> : null;
      };
    `);
  });

  it("flags viewport handlers and cleanup with explicit return statements", () => {
    expectFail(`
      import { useEffect, useState } from "react";
      const ResponsiveSuggestions = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        useEffect(() => {
          const handleResize = () => { return setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { return window.removeEventListener("resize", handleResize); };
        }, []);
        return windowWidth > 500 ? <Suggestions /> : null;
      };
    `);

    expectPass(`
      import { useEffect, useState } from "react";
      const ResponsiveSuggestions = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        const [otherWidth, setOtherWidth] = useState(0);
        useEffect(() => {
          const handleResize = () => { return setOtherWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { return window.removeEventListener("resize", handleResize); };
        }, []);
        return <Suggestions width={windowWidth + otherWidth} />;
      };
    `);
  });

  it("keeps the viewport contract through transparent receivers and no-op statements", () => {
    for (const windowReceiver of ["window", "(window as any)", "window!"]) {
      expectFail(`
        import { useEffect, useState } from "react";
        const Component = () => { void 0;
          const [windowWidth, setWindowWidth] = useState(0);
          useEffect(() => { void 0;
            const handleResize = () => { void 0;
              setWindowWidth(window.innerWidth);
            };
            ${windowReceiver}.addEventListener("resize", handleResize);
            setWindowWidth(window.innerWidth);
            return () => { void 0;
              ${windowReceiver}.removeEventListener("resize", handleResize);
            };
          }, []);
          return <div>{windowWidth}</div>;
        };
      `);
    }
  });

  it("requires the complete proven viewport subscription contract", () => {
    const incompleteEffects = [
      `useEffect(() => {
        const handleResize = () => { setWindowWidth(window.innerWidth); };
        window.addEventListener("resize", handleResize);
        return () => { window.removeEventListener("resize", handleResize); };
      }, []);`,
      `useEffect(() => {
        const handleResize = () => { setWindowWidth(window.innerWidth); };
        window.addEventListener("resize", handleResize);
        setWindowWidth(window.innerWidth);
      }, []);`,
      `useEffect(() => {
        const handleResize = () => { setWindowWidth(window.innerWidth); };
        window.addEventListener("scroll", handleResize);
        setWindowWidth(window.innerWidth);
        return () => { window.removeEventListener("scroll", handleResize); };
      }, []);`,
      `useEffect(() => {
        const handleResize = () => { reportResize(); };
        window.addEventListener("resize", handleResize);
        setWindowWidth(window.innerWidth);
        return () => { window.removeEventListener("resize", handleResize); };
      }, []);`,
      `useEffect(() => {
        let handleResize = () => { setWindowWidth(window.innerWidth); };
        window.addEventListener("resize", handleResize);
        setWindowWidth(window.innerWidth);
        return () => { window.removeEventListener("resize", handleResize); };
      }, []);`,
      `useEffect(() => {
        const handleResize = () => { setWindowWidth(window.innerWidth); };
        window.addEventListener("resize", handleResize);
        setWindowWidth(window.innerWidth);
        reportViewportAdoption();
        return () => { window.removeEventListener("resize", handleResize); };
      }, []);`,
    ];
    for (const effect of incompleteEffects) {
      expectPass(`
        import { useEffect, useState } from "react";
        const Component = () => {
          const [windowWidth, setWindowWidth] = useState(0);
          ${effect}
          return <div>{windowWidth}</div>;
        };
      `);
    }

    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        const [otherWidth, setOtherWidth] = useState(0);
        useEffect(() => {
          const handleResize = () => { setOtherWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", handleResize); };
        }, []);
        return <div>{windowWidth + otherWidth}</div>;
      };
    `);

    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        useEffect(() => {
          const handleResize = () => { setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", differentHandler); };
        }, []);
        return <div>{windowWidth}</div>;
      };
    `);
  });

  it("requires real React hooks, the zero snapshot, global window, and visible state", () => {
    expectPass(`
      const useState = initialValue => [initialValue, () => {}];
      const useEffect = callback => callback();
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        useEffect(() => {
          const handleResize = () => { setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", handleResize); };
        }, []);
        return <div>{windowWidth}</div>;
      };
    `);

    expectPass(`
      import { useEffect, useState } from "react";
      const Component = ({ window }) => {
        const [windowWidth, setWindowWidth] = useState(0);
        useEffect(() => {
          const handleResize = () => { setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", handleResize); };
        }, []);
        return <div>{windowWidth}</div>;
      };
    `);

    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(1);
        useEffect(() => {
          const handleResize = () => { setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", handleResize); };
        }, []);
        return <div>{windowWidth}</div>;
      };
    `);

    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        useEffect(() => {
          const handleResize = () => { setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", handleResize); };
        }, []);
        return null;
      };
    `);

    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        const ariaWidth = windowWidth;
        useEffect(() => {
          const handleResize = () => { setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", handleResize); };
        }, []);
        return <div aria-valuenow={ariaWidth} />;
      };
    `);
  });

  it("does not confuse shadowed viewport names with the state binding", () => {
    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        const renderWidth = (windowWidth) => <span>{windowWidth}</span>;
        let content = null;
        if (true) {
          const windowWidth = 500;
          content = <div>{windowWidth}</div>;
        }
        useEffect(() => {
          const handleResize = () => { setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", handleResize); };
        }, []);
        return <div aria-valuenow={windowWidth}>{content}{renderWidth(500)}</div>;
      };
    `);
  });

  it("requires scalar viewport aliases to remain readonly", () => {
    const viewportEffect = `useEffect(() => {
      const handleResize = () => { setWindowWidth(window.innerWidth); };
      window.addEventListener("resize", handleResize);
      setWindowWidth(window.innerWidth);
      return () => { window.removeEventListener("resize", handleResize); };
    }, []);`;

    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        let visibleWidth = windowWidth;
        visibleWidth = 0;
        ${viewportEffect}
        return <div>{visibleWidth}</div>;
      };
    `);

    expectPass(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        const visibleWidth = windowWidth;
        (visibleWidth as number) = 0;
        ${viewportEffect}
        return <div>{visibleWidth}</div>;
      };
    `);

    expectFail(`
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        const visibleWidth = windowWidth;
        ${viewportEffect}
        return <div>{visibleWidth}</div>;
      };
    `);
  });

  it("does not treat event-handler-only viewport reads as first-paint output", () => {
    const eventOnlyCases = [
      {
        declarations: `const handleClick = () => console.log(windowWidth);`,
        output: `<button onClick={handleClick}>Open</button>`,
      },
      {
        declarations: `const handleActivate = useCallback(() => console.log(windowWidth), [windowWidth]);`,
        output: `<ActionButton onActivate={handleActivate} />`,
      },
      {
        declarations: ``,
        output: `<button onClick={windowWidth > 500 ? desktopClick : mobileClick}>Open</button>`,
      },
      {
        declarations: ``,
        output: `<ActionButton onActivate={windowWidth > 500 ? desktopClick : mobileClick} />`,
      },
      {
        declarations: ``,
        output: `<button onMouseEnter={() => console.log(windowWidth)}>Open</button>`,
      },
    ];
    for (const eventOnlyCase of eventOnlyCases) {
      expectPass(`
        import { useCallback, useEffect, useState } from "react";
        const Component = () => {
          const [windowWidth, setWindowWidth] = useState(0);
          ${eventOnlyCase.declarations}
          useEffect(() => {
            const handleResize = () => { setWindowWidth(window.innerWidth); };
            window.addEventListener("resize", handleResize);
            setWindowWidth(window.innerWidth);
            return () => { window.removeEventListener("resize", handleResize); };
          }, []);
          return ${eventOnlyCase.output};
        };
      `);
    }
  });

  it("does not treat JSX owned by nested functions as component output", () => {
    const nestedFunctionCases = [
      {
        declarations: `const renderUnused = () => <div>{windowWidth}</div>;`,
        output: `<div>Stable</div>`,
      },
      {
        declarations: `const renderUnused = () => { return <div>{windowWidth}</div>; };`,
        output: `<div>Stable</div>`,
      },
      {
        declarations: `setTimeout(() => <div>{windowWidth}</div>, 0);`,
        output: `<div>Stable</div>`,
      },
      {
        declarations: `setTimeout(() => { return <div>{windowWidth}</div>; }, 0);`,
        output: `<div>Stable</div>`,
      },
      {
        declarations: `const handleClick = () => <div>{windowWidth}</div>;`,
        output: `<button onClick={handleClick}>Open</button>`,
      },
      {
        declarations: `const visibleProps = { title: windowWidth };
          const renderUnused = () => <div {...visibleProps} />;`,
        output: `<div>Stable</div>`,
      },
    ];
    for (const nestedFunctionCase of nestedFunctionCases) {
      expectPass(`
        import { useEffect, useState } from "react";
        const Component = () => {
          const [windowWidth, setWindowWidth] = useState(0);
          ${nestedFunctionCase.declarations}
          useEffect(() => {
            const handleResize = () => { setWindowWidth(window.innerWidth); };
            window.addEventListener("resize", handleResize);
            setWindowWidth(window.innerWidth);
            return () => { window.removeEventListener("resize", handleResize); };
          }, []);
          return ${nestedFunctionCase.output};
        };
      `);
    }
  });

  it("classifies exact state-derived JSX spread objects by their static keys", () => {
    const sourceFor = (declarations: string, output: string): string => `
      import { useEffect, useState } from "react";
      const Component = () => {
        const [windowWidth, setWindowWidth] = useState(0);
        ${declarations}
        useEffect(() => {
          const handleResize = () => { setWindowWidth(window.innerWidth); };
          window.addEventListener("resize", handleResize);
          setWindowWidth(window.innerWidth);
          return () => { window.removeEventListener("resize", handleResize); };
        }, []);
        return ${output};
      };
    `;

    for (const [declarations, output] of [
      [
        `const eventProps = { onClick: windowWidth > 500 ? desktopClick : mobileClick };`,
        `<button {...eventProps}>Open</button>`,
      ],
      [
        `const accessibilityProps = { "aria-valuenow": windowWidth };`,
        `<div {...accessibilityProps} />`,
      ],
      [`const identityProps = { id: \`viewport-\${windowWidth}\` };`, `<div {...identityProps} />`],
      [
        `const hiddenProps = { onClick: windowWidth > 500 ? desktopClick : mobileClick };
         const eventProps = hiddenProps;`,
        `<button {...eventProps}>Open</button>`,
      ],
      [`const unknownProps = { [propertyName]: windowWidth };`, `<div {...unknownProps} />`],
      [`const unknownProps = { ...baseProps, title: windowWidth };`, `<div {...unknownProps} />`],
      [
        `const unknownProps = { title: windowWidth };
         unknownProps.title = "fixed";`,
        `<div {...unknownProps} />`,
      ],
      [
        `const visibleProps = { title: windowWidth };
         const aliasProps = visibleProps;
         aliasProps.title = "fixed";`,
        `<div {...visibleProps} />`,
      ],
      [
        `const eventProps = { onClick: windowWidth > 500 ? desktopClick : mobileClick };
         { const eventProps = { title: "fixed" }; console.log(eventProps); }`,
        `<button {...eventProps}>Open</button>`,
      ],
    ]) {
      expectPass(sourceFor(declarations, output));
    }

    for (const [declarations, output] of [
      [
        `const mixedProps = {
           onClick: windowWidth > 500 ? desktopClick : mobileClick,
           title: String(windowWidth),
         };`,
        `<button {...mixedProps}>Open</button>`,
      ],
      [`const dataProps = { "data-width": windowWidth };`, `<div {...dataProps} />`],
      [`const styleProps = { style: { width: windowWidth } };`, `<div {...styleProps} />`],
      [`const valueProps = { value: windowWidth };`, `<output {...valueProps} />`],
      [
        `const classProps = { className: windowWidth > 500 ? "wide" : "narrow" };`,
        `<div {...classProps} />`,
      ],
      [
        `const visibleProps = { title: windowWidth };
         const aliasProps = visibleProps;`,
        `<div {...aliasProps} />`,
      ],
      [
        `const visibleProps = { title: windowWidth };
         { const visibleProps = { onClick: desktopClick }; console.log(visibleProps); }`,
        `<div {...visibleProps} />`,
      ],
    ]) {
      expectFail(sourceFor(declarations, output));
    }
  });

  it("still treats visible content and non-event props as first-paint output", () => {
    for (const output of [
      `<span>{windowWidth}</span>`,
      `<ViewportPanel viewportWidth={windowWidth} />`,
    ]) {
      expectFail(`
        import { useEffect, useState } from "react";
        const Component = () => {
          const [windowWidth, setWindowWidth] = useState(0);
          useEffect(() => {
            const handleResize = () => { setWindowWidth(window.innerWidth); };
            window.addEventListener("resize", handleResize);
            setWindowWidth(window.innerWidth);
            return () => { window.removeEventListener("resize", handleResize); };
          }, []);
          return ${output};
        };
      `);
    }
  });

  it("does not generalize the viewport contract to synthetic control-flow shapes", () => {
    const effectBodies = [
      `useEffect(() => setIsClient(true), []);`,
      `useEffect(() => { (() => setIsClient(true))(); }, []);`,
      `useEffect(() => { if (!isClient) setIsClient(true); }, []);`,
      `useEffect(() => {
        const adoptClientState = () => setIsClient(true);
        adoptClientState();
      }, []);`,
    ];
    for (const effect of effectBodies) {
      expectPass(`
        import { useEffect, useState } from "react";
        const Component = () => {
          const [isClient, setIsClient] = useState(false);
          ${effect}
          return <div>{isClient ? "client" : "server"}</div>;
        };
      `);
    }
  });

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
