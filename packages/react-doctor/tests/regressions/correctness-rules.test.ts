import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-correctness-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("no-array-index-as-key", () => {
  it("flags a key local that is derived from the map index parameter", async () => {
    const projectDir = setupReactProject(tempRoot, "array-index-key-local", {
      files: {
        "src/Locations.tsx": `interface Location {
  nodeId: string;
  documentModuleId: string;
}

export const Locations = ({ locations }: { locations: Location[] }) => (
  <ul>
    {locations.map((location, index) => {
      const itemKey = \`\${location.nodeId}-\${location.documentModuleId}-\${index}\`;
      return <li key={itemKey}>{location.nodeId}</li>;
    })}
  </ul>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-array-index-as-key");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain('"index"');
  });

  it("does not flag a key local derived only from stable item fields", async () => {
    const projectDir = setupReactProject(tempRoot, "stable-local-key", {
      files: {
        "src/Locations.tsx": `interface Location {
  nodeId: string;
  documentModuleId: string;
}

export const Locations = ({ locations }: { locations: Location[] }) => (
  <ul>
    {locations.map((location) => {
      const itemKey = \`\${location.nodeId}-\${location.documentModuleId}\`;
      return <li key={itemKey}>{location.nodeId}</li>;
    })}
  </ul>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-array-index-as-key");
    expect(hits).toHaveLength(0);
  });

  it("does not resolve key locals across nested function boundaries", async () => {
    const projectDir = setupReactProject(tempRoot, "nested-function-shadow-key", {
      files: {
        "src/Locations.tsx": `interface Location {
  nodeId: string;
}

export const Locations = ({ locations }: { locations: Location[] }) => (
  <ul>
    {locations.map((location, index) => {
      const itemKey = \`\${location.nodeId}-\${index}\`;
      void itemKey;
      const renderLocation = () => {
        const itemKey = location.nodeId;
        return <li key={itemKey}>{location.nodeId}</li>;
      };
      return renderLocation();
    })}
  </ul>
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-array-index-as-key");
    expect(hits).toHaveLength(0);
  });
});
