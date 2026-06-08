import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-prefer-keybind-library-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("prefer-keybind-library", () => {
  it("flags a hand-rolled global shortcut wired through useEffect", async () => {
    const projectDir = setupReactProject(tempRoot, "keybind-useeffect", {
      files: {
        "src/CommandPalette.tsx": `import { useEffect, useState } from "react";

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  return open ? <div role="dialog" /> : null;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-keybind-library");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("react-hotkeys-hook");
  });

  it("points at the keybind library the file already imports", async () => {
    const projectDir = setupReactProject(tempRoot, "keybind-existing-library", {
      files: {
        "src/Shortcuts.tsx": `import { tinykeys } from "tinykeys";

export const registerEscape = (close: () => void) => {
  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  });
  return tinykeys;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-keybind-library");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("tinykeys");
  });

  it("does NOT flag a keydown listener that never inspects the key", async () => {
    const projectDir = setupReactProject(tempRoot, "keybind-no-key-check", {
      files: {
        "src/Idle.tsx": `export const trackActivity = (markActive: () => void) => {
  window.addEventListener("keydown", () => markActive());
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-keybind-library");
    expect(hits).toHaveLength(0);
  });

  it("does NOT flag a JSX onKeyDown handler (element-level a11y)", async () => {
    const projectDir = setupReactProject(tempRoot, "keybind-jsx-onkeydown", {
      files: {
        "src/Menu.tsx": `export const Menu = ({ onActivate }: { onActivate: () => void }) => (
  <div
    role="button"
    tabIndex={0}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") onActivate();
    }}
  />
);
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "prefer-keybind-library");
    expect(hits).toHaveLength(0);
  });
});
