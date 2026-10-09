import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

describe("shadowed timer names", () => {
  it.each([
    'const [period, setInterval] = useState("yearly"); return <button onClick={() => setInterval("monthly")} />;',
    'const {setInterval} = useSettings(); return <button onClick={() => setInterval("monthly")} />;',
    'const setInterval = savePeriod; useEffect(() => { setInterval("monthly"); }, []); return null;',
    "const setTimeout = saveDelay; useEffect(() => { setTimeout(100); }, []); return null;",
  ])("does not treat a local binding as a timer: %s", (body) => {
    const result = runRule(
      effectNeedsCleanup,
      `import {useState, useEffect} from 'react'; const Panel = () => { ${body} };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "const Panel = () => <button onClick={() => { setInterval(refresh, 100); }} />;",
    "const Panel = () => { useEffect(() => { setInterval(refresh, 100); }, []); return null; };",
    "const Panel = () => { useEffect(() => { setTimeout(refresh, 100); }, []); return null; };",
    'import {setInterval} from "node:timers"; const Panel = () => <button onClick={() => { setInterval(refresh, 100); }} />;',
    'import {setTimeout} from "timers"; const Panel = () => { useEffect(() => { setTimeout(refresh, 100); }, []); return null; };',
  ])("keeps warnings for native timers: %s", (code) => {
    const result = runRule(effectNeedsCleanup, `import {useEffect} from 'react'; ${code}`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
