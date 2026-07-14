import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { __clearParseSourceFileCacheForTests } from "../../utils/parse-source-file.js";
import { noNoninteractiveElementInteractions } from "./no-noninteractive-element-interactions.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "noninteractive-analytics-"));
  __clearParseSourceFileCacheForTests();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

const runConsumer = (source: string): ReturnType<typeof runRule> => {
  const consumerPath = writeFile("src/integrations-view.tsx", source);
  return runRule(noNoninteractiveElementInteractions, source, { filename: consumerPath });
};

describe("a11y/no-noninteractive-element-interactions — analytics-only callbacks", () => {
  it("stays silent for the Nexu analytics-only informational section", () => {
    writeFile(
      "src/analytics/provider.ts",
      `
export const useAnalytics = () => ({
  track: (event: string, properties: Record<string, string>) => {
    void event;
    void properties;
  },
});
`,
    );
    writeFile(
      "src/analytics/events.ts",
      `
export const trackIntegrationsSkillsTabClick = (
  track: (event: string, properties: Record<string, string>) => void,
  properties: Record<string, string>,
) => track("ui_click", properties);
`,
    );

    const result = runConsumer(`
import { trackIntegrationsSkillsTabClick } from "./analytics/events";
import { useAnalytics } from "./analytics/provider";

export const SkillsComingSoonPanel = () => {
  const analytics = useAnalytics();
  return (
    <section
      aria-labelledby="integration-skills-title"
      onClick={() =>
        trackIntegrationsSkillsTabClick(analytics.track, {
          page_name: "integrations",
          area: "skills_tab",
          element: "coming_soon",
        })
      }
    >
      <h2 id="integration-skills-title">Skills</h2>
      <p>Coming soon</p>
    </section>
  );
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports the same section when its handler exposes user-facing state", () => {
    const result = runConsumer(`
import { useState } from "react";

export const SkillsPanel = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <section onClick={() => setIsOpen(true)}>
      Skills
      {isOpen ? <p>Available skills</p> : null}
    </section>
  );
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("follows import aliases and stable local wrapper aliases", () => {
    writeFile(
      "src/analytics/provider.ts",
      `export const useAnalytics = () => ({ track: (event: string) => void event });`,
    );
    writeFile(
      "src/analytics/events.ts",
      `export const recordSkill = (track: (event: string) => void) => track("skill_viewed");`,
    );
    const result = runConsumer(`
import { recordSkill as importedRecordSkill } from "./analytics/events";
import { useAnalytics as useTelemetryClient } from "./analytics/provider";

export const Panel = () => {
  const analytics = useTelemetryClient();
  const recordSkill = importedRecordSkill;
  const handleClick = () => recordSkill(analytics.track);
  return <section onClick={handleClick}>Coming soon</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("follows namespace imports and optional calls", () => {
    writeFile(
      "src/analytics/provider.ts",
      `export const useAnalytics = () => ({ track: (event: string) => void event });`,
    );
    writeFile(
      "src/analytics/events.ts",
      `export const recordSkill = (track: (event: string) => void) => track?.("skill_viewed");`,
    );
    const result = runConsumer(`
import * as events from "./analytics/events";
import * as provider from "./analytics/provider";

export const Panel = () => {
  const analytics = provider.useAnalytics();
  return <section onClick={() => events.recordSkill?.(analytics.track)}>Coming soon</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a proven PostHog capture", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
export const Panel = () => (
  <section onClick={() => posthog.capture("skill_viewed", { area: "skills" })}>
    Coming soon
  </section>
);
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports telemetry combined with a state update", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
import { useState } from "react";
export const Panel = () => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <section onClick={() => { posthog.capture("skill_viewed"); setIsOpen(true); }}>
      Coming soon
      {isOpen ? <p>Available skills</p> : null}
    </section>
  );
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a state update evaluated as a telemetry argument", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
import { useState } from "react";
export const Panel = () => {
  const [, setIsOpen] = useState(false);
  return <section onClick={() => posthog.capture("skill_viewed", setIsOpen(true))}>Skills</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an opaque callback prop named track", () => {
    const result = runConsumer(`
interface PanelProps { track: () => void }
export const Panel = ({ track }: PanelProps) => <section onClick={() => track()}>Skills</section>;
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a local track lookalike that changes state", () => {
    const result = runConsumer(`
import { useState } from "react";
export const Panel = () => {
  const [, setIsOpen] = useState(false);
  const analytics = { track: () => setIsOpen(true) };
  return <section onClick={() => analytics.track()}>Skills</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an analytics-path helper that invokes an opaque UI callback", () => {
    writeFile(
      "src/analytics/events.ts",
      `export const trackSkill = (performAction: () => void) => performAction();`,
    );
    const result = runConsumer(`
import { useState } from "react";
import { trackSkill } from "./analytics/events";
export const Panel = () => {
  const [, setIsOpen] = useState(false);
  return <section onClick={() => trackSkill(() => setIsOpen(true))}>Skills</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports an unresolved analytics-path import", () => {
    const result = runConsumer(`
import { track } from "./analytics/missing-events";
export const Panel = () => <section onClick={() => track("skill_viewed")}>Skills</section>;
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a reassigned helper", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
import { useState } from "react";
export const Panel = () => {
  const [, setIsOpen] = useState(false);
  let record = posthog.capture;
  record = () => setIsOpen(true);
  return <section onClick={() => record("skill_viewed")}>Skills</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports mixed branches with navigation", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
interface PanelProps { shouldNavigate: boolean }
export const Panel = ({ shouldNavigate }: PanelProps) => (
  <section onClick={() => shouldNavigate ? location.assign("/skills") : posthog.capture("skill_viewed")}>
    Skills
  </section>
);
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a dynamic computed analytics method", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
interface PanelProps { method: string }
export const Panel = ({ method }: PanelProps) => (
  <section onClick={() => posthog[method]("skill_viewed")}>Skills</section>
);
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a state update in a switch case test", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
import { useState } from "react";
export const Panel = () => {
  const [, setIsOpen] = useState(false);
  return <section onClick={() => {
    switch ("skill") {
      case (setIsOpen(true), "skill"):
        posthog.capture("skill_viewed");
    }
  }}>Skills</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a state update in a helper parameter default", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
import { useState } from "react";
export const Panel = () => {
  const [, setIsOpen] = useState(false);
  const record = (event = (setIsOpen(true), "skill_viewed")) => posthog.capture(event);
  return <section onClick={() => record()}>Skills</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports state updates in destructuring defaults and computed keys", () => {
    const result = runConsumer(`
import posthog from "posthog-js";
import { useState } from "react";
export const Panel = () => {
  const [, setIsOpen] = useState(false);
  return <section onClick={() => {
    const { value = setIsOpen(true), [String(setIsOpen(true))]: selected } = {};
    posthog.capture("skill_viewed", { value, selected });
  }}>Skills</section>;
};
`);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
