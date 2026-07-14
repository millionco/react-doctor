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

interface SkillsComingSoonPanelProps {
  track: (event: string, properties: Record<string, string>) => void;
}

export const SkillsComingSoonPanel = ({ track }: SkillsComingSoonPanelProps) => (
  <section
    aria-labelledby="integration-skills-title"
    onClick={() =>
      trackIntegrationsSkillsTabClick(track, {
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
});
