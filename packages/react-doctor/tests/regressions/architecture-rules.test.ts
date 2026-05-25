import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { collectRuleHits, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-architecture-rules-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("react-compiler-destructure-method", () => {
  it("does not flag React Navigation methods", async () => {
    const projectDir = setupReactProject(tempRoot, "react-navigation-methods", {
      files: {
        "src/Screen.tsx": `import { useNavigation } from "@react-navigation/native";

declare function useRouter(): {
  push: (path: string) => void;
};

declare module "@react-navigation/native" {
  export function useNavigation(): {
    navigate: (screen: string, params?: { sessionId: string }) => void;
  };
}

export const WebRouteButton = () => {
  const router = useRouter();
  return <button onClick={() => router.push("/home")}>Go home</button>;
};

export const NativeRouteButton = () => {
  const navigation = useNavigation();
  return (
    <button onClick={() => navigation.navigate("Chat", { sessionId: "abc" })}>
      Open chat
    </button>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-destructure-method");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("useRouter");
    expect(hits[0].message).not.toContain("useNavigation");
  });

  it("does not flag React Navigation core methods", async () => {
    const projectDir = setupReactProject(tempRoot, "react-navigation-core-methods", {
      files: {
        "src/Screen.tsx": `import { useNavigation } from "@react-navigation/core";

declare module "@react-navigation/core" {
  export function useNavigation(): {
    dispatch: (action: { type: string }) => void;
  };
}

export const NativeRouteButton = () => {
  const navigation = useNavigation();
  return <button onClick={() => navigation.dispatch({ type: "GO_BACK" })}>Back</button>;
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-destructure-method");
    expect(hits).toHaveLength(0);
  });

  it("still flags non-React-Navigation useNavigation hooks", async () => {
    const projectDir = setupReactProject(tempRoot, "custom-use-navigation-methods", {
      files: {
        "src/Screen.tsx": `declare function useNavigation(): {
  navigate: (screen: string, params?: { sessionId: string }) => void;
};

export const RouteButton = () => {
  const navigation = useNavigation();
  return (
    <button onClick={() => navigation.navigate("Chat", { sessionId: "abc" })}>
      Open chat
    </button>
  );
};
`,
      },
    });

    const hits = await collectRuleHits(projectDir, "react-compiler-destructure-method");
    expect(hits).toHaveLength(1);
    expect(hits[0].message).toContain("useNavigation");
  });
});
