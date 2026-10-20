import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";

const cachedResultComponent = `
import { useEffect, useRef, useState } from "react";
interface Item { label: string }
interface Props { itemId: string; fetchItem: (itemId: string) => Promise<Item | null> }
const ItemPanel = ({ itemId, fetchItem }: Props) => {
  const records = useRef(new Map<string, Item>());
  const [item, setItem] = useState<Item | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  useEffect(() => {
    const requestedId = itemId;
    const storedItem = records.current.get(requestedId);
    if (storedItem) {
      setItem(storedItem);
      setLoadedId(requestedId);
      return;
    }
    setItem(null);
    setLoadedId(null);
    let cancelled = false;
    void (async () => {
      const fetchedItem = await fetchItem(requestedId);
      if (cancelled || !fetchedItem) return;
      records.current.set(requestedId, fetchedItem);
      setItem(fetchedItem);
      setLoadedId(requestedId);
    })();
    return () => { cancelled = true; };
  }, [itemId, fetchItem]);
  const displayedItem = loadedId === itemId ? item : null;
  return <span>{displayedItem?.label}</span>;
};
`;

const cachedResultWithCleanup = cachedResultComponent
  .replace("useEffect, useRef, useState", "useCallback, useEffect, useRef, useState")
  .replace(
    "interface Item { label: string }",
    "interface Item { label: string; destroy: () => void }",
  )
  .replace("interface Props { itemId: string;", "interface Props { open: boolean; itemId: string;")
  .replace("({ itemId, fetchItem }: Props)", "({ open, itemId, fetchItem }: Props)")
  .replace(
    "  useEffect(() => {",
    `
  const [pending, setPending] = useState(false);
  const releaseItems = useCallback(() => {
    records.current.forEach((record) => { record.destroy(); });
    records.current.clear();
  }, []);
  useEffect(() => {
    if (!open) { setItem(null); setLoadedId(null); return; }
`,
  )
  .replace(
    "setLoadedId(requestedId);\n      return;",
    "setLoadedId(requestedId); setPending(false); return;",
  )
  .replace(
    "const displayedItem =",
    `
  useEffect(() => {
    if (!open && item === null) { releaseItems(); }
  }, [open, item, releaseItems]);
  useEffect(() => { return () => { releaseItems(); }; }, [releaseItems]);
  const displayedItem =`,
  );

describe("no-derived-state cached async result identity", () => {
  it("keeps the key paired with the loaded payload", () => {
    const result = runRule(noDerivedState, cachedResultComponent);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("supports paired resets and closed cache cleanup after the payload is cleared", () => {
    const result = runRule(noDerivedState, cachedResultWithCleanup);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("supports cancellation cleanup and paired resets after an acquisition rejects", () => {
    const code = cachedResultComponent
      .replace(
        "interface Item { label: string }",
        "interface Item { label: string; destroy: () => void }",
      )
      .replace("void (async () => {", "void (async () => { try {")
      .replace(
        "if (cancelled || !fetchedItem) return;",
        `
      if (cancelled) { fetchedItem?.destroy(); return; }
      if (!fetchedItem) { setItem(null); setLoadedId(null); return; }
`,
      )
      .replace(
        "    })();",
        `
      } catch (failure) {
        if (!cancelled) { setItem(null); setLoadedId(null); }
      }
    })();`,
      );
    const result = runRule(noDerivedState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["missing render mask", "loadedId === itemId ? item : null", "item"],
    [
      "mismatched render key",
      "loadedId === itemId ? item : null",
      'loadedId === "fixed" ? item : null',
    ],
    ["unmasked payload exposure", "{displayedItem?.label}", "{item?.label}{displayedItem?.label}"],
    [
      "wrong insertion key",
      "records.current.set(requestedId, fetchedItem)",
      'records.current.set("other", fetchedItem)',
    ],
    [
      "missing async stamp",
      "setItem(fetchedItem);\n      setLoadedId(requestedId);",
      "setItem(fetchedItem);",
    ],
    ["different cached payload", "setItem(storedItem)", 'setItem({ label: "unrelated" })'],
    ["escaped payload setter", "const displayedItem =", "publish(setItem); const displayedItem ="],
    ["escaped cache", "const displayedItem =", "publish(records.current); const displayedItem ="],
    [
      "replaced cache method",
      "const displayedItem =",
      "records.current.get = lookup; const displayedItem =",
    ],
    ["unpaired payload reset", "setItem(null);\n    setLoadedId(null);", "setItem(null);"],
    [
      "opaque call between paired writes",
      "setItem(storedItem);\n      setLoadedId",
      "setItem(storedItem);\n      notify();\n      setLoadedId",
    ],
    ["cache read during render", "return <span>", "records.current.get(itemId); return <span>"],
    [
      "absent cancellation guard",
      "if (cancelled || !fetchedItem) return;",
      "if (!fetchedItem) return;",
    ],
    ["wrong asynchronous payload", "setItem(fetchedItem)", "setItem(storedItem)"],
  ])("retains the existing warning for %s", (_scenario, before, after) => {
    const result = runRule(noDerivedState, cachedResultComponent.replace(before, after));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('"loadedId"'))).toBe(
      true,
    );
  });

  it.each([
    [
      "literal cached stamp",
      cachedResultComponent.replace("setLoadedId(requestedId);", 'setLoadedId("other");'),
    ],
    [
      "independent event writer",
      cachedResultComponent.replace(
        "return <span>",
        "const updateLoadedId = () => setLoadedId(itemId); return <span onClick={updateLoadedId}>",
      ),
    ],
    [
      "mutable request capture",
      cachedResultComponent
        .replace("const requestedId =", "let requestedId =")
        .replace(
          "records.current.set(requestedId, fetchedItem);",
          'requestedId = "other"; records.current.set(requestedId, fetchedItem);',
        ),
    ],
  ])("preserves existing quiet behavior for %s", (_scenario, code) => {
    const result = runRule(noDerivedState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "a cancellation check before acquisition",
      cachedResultComponent
        .replace("const fetchedItem = await", "if (cancelled) return; const fetchedItem = await")
        .replace("if (cancelled || !fetchedItem) return;", "if (!fetchedItem) return;"),
    ],
    [
      "another suspension after the cancellation check",
      cachedResultComponent.replace(
        "if (cancelled || !fetchedItem) return;",
        "if (cancelled || !fetchedItem) return; await pause();",
      ),
    ],
    [
      "writes from a finally block after a cancelled return",
      cachedResultComponent
        .replace(
          "if (cancelled || !fetchedItem) return;",
          "try { if (cancelled || !fetchedItem) return; } finally {",
        )
        .replace("    })();", "      }\n    })();"),
    ],
  ])("retains the warning for %s", (_scenario, code) => {
    const result = runRule(noDerivedState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('"loadedId"'))).toBe(
      true,
    );
  });

  it.each([
    [
      "a default parameter before cancellation",
      cachedResultComponent.replace(
        "return () => { cancelled = true; };",
        "return (ignored = failCleanup()) => { cancelled = true; };",
      ),
    ],
    [
      "an async lifetime effect",
      cachedResultWithCleanup.replace(
        "useEffect(() => { return () => { releaseItems(); }; }, [releaseItems]);",
        "useEffect(async () => { return () => { releaseItems(); }; }, [releaseItems]);",
      ),
    ],
    [
      "a generator lifetime effect",
      cachedResultWithCleanup.replace(
        "useEffect(() => { return () => { releaseItems(); }; }, [releaseItems]);",
        "useEffect(function* () { return () => { releaseItems(); }; }, [releaseItems]);",
      ),
    ],
    [
      "a replaced native Map provider",
      `
class WrongMap {
  value: Item | null = null;
  get(key: string) { return this.value; }
  set(key: string, value: Item) { this.value = value; return this; }
}
Object.assign(globalThis, { Map: WrongMap });
` + cachedResultComponent,
    ],
  ])("retains the warning for %s", (_scenario, code) => {
    const result = runRule(noDerivedState, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.message.includes('"loadedId"'))).toBe(
      true,
    );
  });

  it("retains an unrelated derived copy beside the result stamp", () => {
    const result = runRule(
      noDerivedState,
      cachedResultComponent.replace(
        "const displayedItem =",
        'const [copy, setCopy] = useState(""); useEffect(() => { setCopy(itemId); }, [itemId]); const displayedItem =',
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Storing "copy" in state when you can derive it from other values costs an extra render.',
    ]);
  });

  it.each([
    "interface Map {}",
    "type Map = unknown;",
    "interface useState {}",
    "interface useRef {}",
    "interface useEffect {}",
  ])("ignores erased provider names: %s", (declaration) => {
    const code = cachedResultComponent.replace("interface Item", `${declaration}\ninterface Item`);
    for (const rule of [noDerivedState, noDerivedStateEffect]) {
      const result = runRule(rule, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it.each([
    "declare const Map: new (...args: unknown[]) => unknown;",
    "declare function Map(...args: unknown[]): unknown;",
    "const Map = CustomMap;",
  ])("retains unknown value providers: %s", (declaration) => {
    const code = cachedResultComponent.replace("interface Item", `${declaration}\ninterface Item`);
    for (const rule of [noDerivedState, noDerivedStateEffect]) {
      const result = runRule(rule, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([
    "declare const Map: new (...args: unknown[]) => unknown;",
    "declare function Map(...args: unknown[]): unknown;",
  ])("preserves outer ambient providers through inner interfaces: %s", (declaration) => {
    const code = cachedResultComponent
      .replace("interface Item", `${declaration}\ninterface Item`)
      .replace("  const records =", "  interface Map {}\n  const records =");
    for (const rule of [noDerivedState, noDerivedStateEffect]) {
      const result = runRule(rule, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });

  it.each([cachedResultComponent, cachedResultWithCleanup])(
    "suppresses the equivalent fallback rule for the same certified identity stamp",
    (code) => {
      const result = runRule(noDerivedStateEffect, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("keeps unrelated fallback findings after excluding a certified stamp", () => {
    const result = runRule(
      noDerivedStateEffect,
      cachedResultComponent.replace(
        "const displayedItem =",
        'const [copy, setCopy] = useState(""); useEffect(() => { setCopy(itemId); }, [itemId]); const displayedItem =',
      ),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
