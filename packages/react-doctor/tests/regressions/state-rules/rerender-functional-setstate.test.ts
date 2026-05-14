import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("rerender-functional-setstate");

describe("rerender-functional-setstate (extended to spread)", () => {
  it("flags `setMessages([...messages, item])` array-spread shape", async () => {
    // https://react.dev/learn/removing-effect-dependencies#are-you-reading-some-state-to-calculate-the-next-state
    const projectDir = setupReactProject(tempRoot, "rerender-functional-setstate-array-spread", {
      files: {
        "src/Chat.tsx": `import { useEffect, useState } from "react";

declare const subscribe: (handler: (message: string) => void) => () => void;

export const Chat = () => {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    return subscribe((received) => {
      setMessages([...messages, received]);
    });
  }, [messages]);
  return <ul>{messages.map((line) => <li key={line}>{line}</li>)}</ul>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-functional-setstate");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain("[...messages");
    expect(hits[0].message).toContain("functional update");
  });

  it("flags `setProfile({ ...profile, name })` object-spread shape", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-functional-setstate-object-spread", {
      files: {
        "src/Profile.tsx": `import { useState } from "react";

export const Profile = () => {
  const [profile, setProfile] = useState({ name: "", email: "" });
  const onChangeName = (event: { target: { value: string } }) => {
    setProfile({ ...profile, name: event.target.value });
  };
  return (
    <input
      value={profile.name}
      onChange={onChangeName}
    />
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-functional-setstate");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].message).toContain("...profile");
  });

  it("does NOT flag `setMessages(msgs => [...msgs, item])` (the recommended fix)", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-functional-setstate-good", {
      files: {
        "src/Chat.tsx": `import { useEffect, useState } from "react";

declare const subscribe: (handler: (message: string) => void) => () => void;

export const Chat = () => {
  const [messages, setMessages] = useState<string[]>([]);
  useEffect(() => {
    return subscribe((received) => {
      setMessages((msgs) => [...msgs, received]);
    });
  }, []);
  return <ul>{messages.map((line) => <li key={line}>{line}</li>)}</ul>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-functional-setstate");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag `setItems([...other, x])` where the spread source is unrelated", async () => {
    const projectDir = setupReactProject(tempRoot, "rerender-functional-setstate-unrelated", {
      files: {
        "src/Merge.tsx": `import { useState } from "react";

export const Merge = ({ baseline }: { baseline: string[] }) => {
  const [items, setItems] = useState<string[]>([]);
  const onReset = () => setItems([...baseline, "first"]);
  return <button onClick={onReset}>{items.length}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "rerender-functional-setstate");
    expect(hits).toHaveLength(0);
  });
});
