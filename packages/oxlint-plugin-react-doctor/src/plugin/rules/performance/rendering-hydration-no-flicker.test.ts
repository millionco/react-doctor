import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingHydrationNoFlicker } from "./rendering-hydration-no-flicker.js";

describe("performance/rendering-hydration-no-flicker", () => {
  it("does not require an SSR capability", () => {
    expect(renderingHydrationNoFlicker.requires).toBeUndefined();
  });

  it("flags a client-rendered mount flash", () => {
    const result = runRule(
      renderingHydrationNoFlicker,
      `import { useEffect, useState } from "react";
      const Calendar = () => {
        const [events, setEvents] = useState([]);
        useEffect(() => {
          setEvents([{ id: "conference" }]);
        }, []);
        return <CalendarView events={events} />;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("after the first paint");
    expect(result.diagnostics[0]?.message).not.toContain("suppressHydrationWarning");
  });

  it("flags a React Native mount flash", () => {
    const result = runRule(
      renderingHydrationNoFlicker,
      `import { useEffect, useState } from "react";
      import { Text } from "react-native";
      const WelcomeMessage = () => {
        const [message, setMessage] = useState("");
        useEffect(() => {
          setMessage("Welcome back");
        }, []);
        return <Text>{message}</Text>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a mount-only useEffect whose sole statement is a setState", () => {
    const result = runRule(
      renderingHydrationNoFlicker,
      `import { useEffect, useState } from "react";
      const Component = () => {
        const [isClient, setIsClient] = useState(false);
        useEffect(() => {
          setIsClient(true);
        }, []);
        return <div>{isClient ? "client" : "server"}</div>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // Fuzz corpus regression (facebook/react#34858): useLayoutEffect runs
  // synchronously BEFORE paint, so mount-time setState there never
  // flashes — it's the canonical DOM-measurement pattern.
  it("stays silent on the useLayoutEffect measurement pattern", () => {
    const result = runRule(
      renderingHydrationNoFlicker,
      `import { useLayoutEffect, useRef, useState } from "react";
      const Tooltip = () => {
        const ref = useRef(null);
        const [tooltipHeight, setTooltipHeight] = useState(0);
        useLayoutEffect(() => {
          setTooltipHeight(ref.current?.getBoundingClientRect().height ?? 0);
        }, []);
        return <div ref={ref}>{tooltipHeight}</div>;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the effect has dependencies", () => {
    const result = runRule(
      renderingHydrationNoFlicker,
      `import { useEffect, useState } from "react";
      const Component = ({ value }) => {
        const [mirror, setMirror] = useState(value);
        useEffect(() => {
          setMirror(value);
        }, [value]);
        return <div>{mirror}</div>;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the effect body has more than one statement", () => {
    const result = runRule(
      renderingHydrationNoFlicker,
      `import { useEffect, useState } from "react";
      const Component = () => {
        const [ready, setReady] = useState(false);
        useEffect(() => {
          const id = requestAnimationFrame(() => {});
          setReady(true);
        }, []);
        return <div>{ready ? "yes" : "no"}</div>;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
