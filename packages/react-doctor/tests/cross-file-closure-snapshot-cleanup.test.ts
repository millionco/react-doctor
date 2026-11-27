import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { collectCrossFileDependencyProbes as collectActualProbes } from "../../oxlint-plugin-react-doctor/src/plugin/cross-file-dependencies.js";
import {
  createCrossFileClosureSnapshot,
  isCurrentCrossFileClosureSnapshot,
} from "../src/cli/utils/cross-file-closure-snapshot.js";

vi.mock("oxlint-plugin-react-doctor/core", async () => {
  const { hasPotentialCallerEventListSource } =
    await import("../../oxlint-plugin-react-doctor/src/plugin/utils/has-potential-caller-event-list-proof.js");
  return {
    hasPotentialCallerEventListSource,
    hasPotentialSplitGenerationReactSource: vi.fn(() => false),
    resetManifestCaches: vi.fn(),
    collectCrossFileDependencyProbes: vi.fn(() => ({
      contentPaths: [],
      existencePaths: [],
      directoryPaths: [],
      realpathPaths: [],
    })),
  };
});
vi.mock("@react-doctor/core", () => ({ readRealpathIdentity: vi.fn(() => null) }));
vi.mock("@react-doctor/core/scan-preamble", () => ({ resolveGitCommand: vi.fn() }));

const source = `const defaultEvents = ["click"];
export function useEvents(handler, events = defaultEvents) {
  useEffect(() => {
    for (const name of events) document.addEventListener(name, handler);
    return () => {
      for (const name of events) document.removeEventListener(name, handler);
    };
  }, [handler, events]);
}`;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const setup = (sourceText: string) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-closure-cache-"));
  roots.push(root);
  const focal = path.join(root, "use-events.js");
  fs.writeFileSync(focal, sourceText);
  return { root, focal };
};
const collect = (absoluteFilePath: string, sourceText: string) =>
  collectActualProbes({ absoluteFilePath, sourceText, ruleIds: ["effect-needs-cleanup"] });

describe("caller-dependent effect default list cache", () => {
  it("rejects both storage paths after a caller-only edit even without focal imports", () => {
    const { root, focal } = setup(source);
    const caller = path.join(root, "caller.js");
    fs.writeFileSync(caller, 'import { useEvents } from "./use-events"; useEvents(handler);');
    expect(createCrossFileClosureSnapshot(root, ["use-events.js"])).toBeNull();
    expect(collect(focal, source)).toBeNull();
    fs.writeFileSync(
      caller,
      'import { useEvents } from "./use-events"; useEvents(handler, current);',
    );
    expect(createCrossFileClosureSnapshot(root, ["use-events.js"])).toBeNull();
    expect(collect(focal, source)).toBeNull();
    expect(fs.readFileSync(focal, "utf8")).toBe(source);
  });

  it("rejects a saved snapshot that recorded the focal but omitted its caller", () => {
    const { focal } = setup(source);
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    expect(
      isCurrentCrossFileClosureSnapshot({
        contentPaths: [focal],
        existencePaths: [],
        directoryPaths: [],
        realpathPaths: [],
        fingerprint: hash(JSON.stringify([[[focal, hash(source)]], [], [], []])),
      }),
    ).toBe(false);
  });

  it("preserves caching for loop collections with no default parameter", () => {
    const altered = source.replace("events = defaultEvents", "events");
    const { root, focal } = setup(altered);
    expect(createCrossFileClosureSnapshot(root, ["use-events.js"])).not.toBeNull();
    expect(collect(focal, altered)).not.toBeNull();
  });

  it("catches escaped static listener spelling and transparent event wrappers", () => {
    const altered = source
      .replaceAll("addEventListener", "addEvent\\u004cistener")
      .replaceAll("removeEventListener", "removeEvent\\u004cistener")
      .replaceAll(" of events", " of (events)");
    const { root, focal } = setup(altered);
    expect(createCrossFileClosureSnapshot(root, ["use-events.js"])).toBeNull();
    expect(collect(focal, altered)).toBeNull();
  });
});
