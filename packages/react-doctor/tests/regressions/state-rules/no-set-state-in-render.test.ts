import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-set-state-in-render");

describe("no-set-state-in-render", () => {
  it("flags an unconditional top-level setter call", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-pos", {
      files: {
        "src/Greeting.tsx": `import { useState } from "react";

export const Greeting = () => {
  const [name, setName] = useState("");
  setName("Alice");
  return <h1>{name}</h1>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("setName");
  });

  it("does not flag the canonical conditional 'derive state from props' pattern", async () => {
    // https://react.dev/reference/react/useState#storing-information-from-previous-renders
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-conditional", {
      files: {
        "src/CountLabel.tsx": `import { useState } from "react";

export const CountLabel = ({ count }: { count: number }) => {
  const [prevCount, setPrevCount] = useState(count);
  const [trend, setTrend] = useState<string | null>(null);
  if (prevCount !== count) {
    setPrevCount(count);
    setTrend(count > prevCount ? "up" : "down");
  }
  return <h1>{trend}</h1>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a setter call inside an event handler", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-handler", {
      files: {
        "src/Counter.tsx": `import { useState } from "react";

export const Counter = () => {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a setter call inside useEffect", async () => {
    const projectDir = setupReactProject(tempRoot, "no-set-state-in-render-effect", {
      files: {
        "src/Loader.tsx": `import { useEffect, useState } from "react";

export const Loader = () => {
  const [data, setData] = useState<string | null>(null);
  useEffect(() => {
    setData("loaded");
  }, []);
  return <div>{data}</div>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-set-state-in-render");
    expect(hits).toHaveLength(0);
  });
});
