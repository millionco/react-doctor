import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { onlyExportComponents } from "./only-export-components.js";
const source =
  "import {observer} from 'mobx-react-lite'; const Badge=observer(()=> <span/>); export const Card=()=> <Badge/>; export default Badge;";
const options = {
  filename: "src/observer-role.tsx",
  settings: { "react-doctor": { framework: "vite" } },
};
describe("only-export-components erased namespace providers", () => {
  it.each([
    { name: "direct", prefix: "require('mobx-react-lite').observer=()=>42;", expected: 1 },
    {
      name: "empty",
      prefix: "namespace require {} require('mobx-react-lite').observer=()=>42;",
      expected: 1,
    },
    {
      name: "type-only",
      prefix:
        "namespace require { export interface Marker {} } require('mobx-react-lite').observer=()=>42;",
      expected: 1,
    },
    {
      name: "nested",
      prefix:
        "namespace require { export namespace Inner { export type Marker = unknown; } } require('mobx-react-lite').observer=()=>42;",
      expected: 1,
    },
    {
      name: "runtime",
      prefix:
        "namespace require { export const marker = 0; } require('mobx-react-lite').observer=()=>42;",
      expected: 1,
    },
  ])("preserves emitted binding: $name", ({ prefix, expected }) => {
    const result = runRule(onlyExportComponents, prefix + "\n" + source, options);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
