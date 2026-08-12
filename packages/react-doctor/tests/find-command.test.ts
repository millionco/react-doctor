import * as path from "node:path";
import { searchSymbols } from "@rayhanadev/truffler";
import type { SymbolSearchResult } from "@rayhanadev/truffler";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { findAction } from "../src/cli/commands/find.js";
import { CliInputError } from "../src/cli/utils/cli-input-error.js";
import { METRIC } from "../src/cli/utils/constants.js";
import { formatFindSymbolResult } from "../src/cli/utils/format-find-symbol-result.js";
import { parseFindKinds } from "../src/cli/utils/parse-find-kinds.js";
import { recordCount } from "../src/cli/utils/record-metric.js";
import { resolveFindSymbolKind } from "../src/cli/utils/resolve-find-symbol-kind.js";
import { captureStdout } from "./helpers/capture-stdout.js";

vi.mock("@rayhanadev/truffler", () => ({ searchSymbols: vi.fn() }));
vi.mock("../src/cli/utils/record-metric.js", () => ({ recordCount: vi.fn() }));

const TEST_CWD = process.cwd();

const createResult = (
  name: string,
  kind: SymbolSearchResult["kind"],
  file = path.join(TEST_CWD, "src/example.tsx"),
): SymbolSearchResult => ({
  name,
  kind,
  file,
  start: 14,
  end: 14 + name.length,
  line: 2,
  column: 15,
  signature: `${kind} ${name}`,
  score: 100,
  matches: [0],
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("React-aware find kinds", () => {
  it("classifies PascalCase functions and classes as components", () => {
    expect(resolveFindSymbolKind(createResult("Button", "function"))).toBe("component");
    expect(resolveFindSymbolKind(createResult("ErrorBoundary", "class"))).toBe("component");
    expect(resolveFindSymbolKind(createResult("ButtonProps", "interface"))).toBe("interface");
  });

  it("classifies common HOC and styled bindings as components", () => {
    expect(
      resolveFindSymbolKind({
        ...createResult("Profile", "constant"),
        signature: "Profile = observer(memo(ProfileView))",
      }),
    ).toBe("component");
    expect(
      resolveFindSymbolKind({
        ...createResult("Button", "constant"),
        signature: "Button = styled.button`color: red`",
      }),
    ).toBe("component");
    expect(resolveFindSymbolKind(createResult("DEFAULT_THEME", "constant"))).toBe("constant");
  });

  it("recognizes custom hooks, numbered hooks, and React 19 use", () => {
    expect(resolveFindSymbolKind(createResult("useCounter", "function"))).toBe("hook");
    expect(resolveFindSymbolKind(createResult("use2D", "function"))).toBe("hook");
    expect(resolveFindSymbolKind(createResult("use", "function"))).toBe("hook");
    expect(resolveFindSymbolKind(createResult("useStore", "constant"))).toBe("hook");
    expect(resolveFindSymbolKind(createResult("useful", "function"))).toBe("function");
  });

  it("expands component and hook filters to their syntax kinds", () => {
    expect(parseFindKinds("component").symbolKinds).toEqual([
      "class",
      "constant",
      "function",
      "variable",
    ]);
    expect(parseFindKinds("hook").symbolKinds).toEqual(["constant", "function", "variable"]);
    expect(parseFindKinds("component,interface").symbolKinds).toEqual([
      "class",
      "constant",
      "function",
      "variable",
      "interface",
    ]);
  });

  it("rejects unsupported filters", () => {
    expect(() => parseFindKinds("component,banana")).toThrow(CliInputError);
  });
});

describe("findAction", () => {
  it("prints grep-friendly component results and records adoption", async () => {
    vi.mocked(searchSymbols).mockResolvedValue([
      createResult("Button", "function"),
      createResult("ButtonProps", "interface"),
    ]);
    const output = captureStdout();

    await findAction("btn", "src", { cwd: TEST_CWD, kind: "component", limit: "10" });

    expect(recordCount).toHaveBeenCalledWith(METRIC.cliInvoked, 1, { command: "find" });
    expect(searchSymbols).toHaveBeenCalledWith(
      "btn",
      expect.objectContaining({
        cwd: TEST_CWD,
        root: "src",
        symbolKinds: ["class", "constant", "function", "variable"],
      }),
    );
    expect(output.lines.join("")).toBe("src/example.tsx:2:15  component  function Button\n");
    output.restore();
  });

  it("normalizes behavior phrases into identifier queries", async () => {
    vi.mocked(searchSymbols).mockResolvedValue([createResult("parseFindKinds", "function")]);
    const output = captureStdout();

    await findAction(" parse find kinds ", "src", { cwd: TEST_CWD });

    expect(searchSymbols).toHaveBeenCalledWith("parsefindkinds", expect.any(Object));
    expect(output.lines.join("")).toContain("parseFindKinds");
    output.restore();
  });

  it("rejects invalid limits", async () => {
    await expect(findAction("Button", ".", { cwd: TEST_CWD, limit: -1 })).rejects.toThrow(
      CliInputError,
    );
    await expect(findAction("Button", ".", { cwd: TEST_CWD, limit: "1.5" })).rejects.toThrow(
      CliInputError,
    );
    await expect(findAction("Button", ".", { cwd: TEST_CWD, limit: "" })).rejects.toThrow(
      CliInputError,
    );
  });

  it("emits structured hook results with their syntax kind", async () => {
    vi.mocked(searchSymbols).mockResolvedValue([
      createResult("useCounter", "function"),
      createResult("useful", "function"),
    ]);
    const output = captureStdout();

    await findAction("use", ".", { cwd: TEST_CWD, kind: "hook", json: true });

    const parsedOutput = JSON.parse(output.lines.join(""));
    expect(parsedOutput.count).toBe(1);
    expect(parsedOutput.results[0]).toMatchObject({
      name: "useCounter",
      kind: "hook",
      symbolKind: "function",
      location: { file: "src/example.tsx", line: 2, column: 15 },
    });
    output.restore();
  });

  it("formats files outside the working directory as absolute paths", () => {
    expect(
      formatFindSymbolResult(createResult("Button", "function", "/other/Button.tsx"), "/repo"),
    ).toBe("/other/Button.tsx:2:15  component  function Button");
  });
});
