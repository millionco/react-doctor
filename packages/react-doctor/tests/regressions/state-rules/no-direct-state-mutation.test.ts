import { describe, expect, it } from "vite-plus/test";

import { collectRuleHits, createScopedTempRoot, setupReactProject } from "./_helpers.js";

const tempRoot = createScopedTempRoot("no-direct-state-mutation");

describe("no-direct-state-mutation", () => {
  it("flags push/pop/splice/sort/reverse and member assignment on useState values", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-pos", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  const [profile, setProfile] = useState({ tags: [] as string[] });
  void setItems;
  void setProfile;

  const onAdd = (next: string) => {
    items.push(next);
    items[0] = next;
    profile.tags.push(next);
    items.splice(0, 1);
    items.sort();
    items.reverse();
  };

  return <button onClick={() => onAdd("x")}>{items.length}</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    // 6 mutations on \`items\` + 1 on \`profile.tags\`.
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(hits.some((hit) => hit.message.includes('"items"'))).toBe(true);
    expect(hits.some((hit) => hit.message.includes('"profile"'))).toBe(true);
  });

  it("does not flag immutable counterparts (toSorted/toReversed/toSpliced)", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-immutable", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  const onSort = () => setItems(items.toSorted());
  const onReverse = () => setItems(items.toReversed());
  const onSplice = () => setItems(items.toSpliced(0, 1));
  void onSort;
  void onReverse;
  void onSplice;
  return <span>{items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a local variable that shadows a useState name", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-shadow", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const buildLocal = (raw: string) => {
    const items = raw.split(",");
    items.push("extra");
    return items;
  };

  return <span>{buildLocal("a,b").length + items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });

  it("does not flag a parameter that shadows a useState name", async () => {
    const projectDir = setupReactProject(tempRoot, "no-direct-state-mutation-param-shadow", {
      files: {
        "src/Cart.tsx": `import { useState } from "react";

export const Cart = () => {
  const [items, setItems] = useState<string[]>([]);
  void setItems;

  const helper = (items: string[]) => {
    items.push("local");
    return items;
  };

  return <span>{helper(["a"]).length + items.length}</span>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "no-direct-state-mutation");
    expect(hits).toHaveLength(0);
  });
});
