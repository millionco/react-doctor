import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { onlyExportComponents } from "./only-export-components.js";
const source =
  "import {observer} from 'mobx-react-lite'; const Badge=observer(()=> <span/>); export const Card=()=> <Badge/>; export default Badge;";
const options = {
  filename: "src/observer-role.tsx",
  settings: { "react-doctor": { framework: "vite" } },
};
describe("runtime imported provider reference attribution", () => {
  it.each([
    { name: "baseline", prefix: "", expected: 0 },
    {
      name: "observer-direct",
      prefix: "const rewriteProvider=()=>{ mutate(observer);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "observer-interface",
      prefix:
        "const rewriteProvider=()=>{interface observer {} mutate(observer);}; rewriteProvider();",
      expected: 1,
    },
    {
      name: "observer-typealias",
      prefix:
        "const rewriteProvider=()=>{type observer=unknown; mutate(observer);}; rewriteProvider();",
      expected: 1,
    },
  ])("preserves runtime exposure: $name", ({ prefix, expected }) => {
    const result = runRule(onlyExportComponents, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
