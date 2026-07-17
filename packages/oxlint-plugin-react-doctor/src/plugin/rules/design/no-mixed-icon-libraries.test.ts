import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMixedIconLibraries } from "./no-mixed-icon-libraries.js";

describe("no-mixed-icon-libraries", () => {
  it("flags imports from separate icon families", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { Search } from "lucide-react"; import { HomeIcon } from "@heroicons/react/24/outline"; const Toolbar = () => <><Search /><HomeIcon /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats separate react-icons packs as separate visual families", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { FaHome } from "react-icons/fa"; import { MdSearch } from "react-icons/md"; const Toolbar = () => <><FaHome /><MdSearch /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts subpath imports from one family", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import { HomeIcon } from "@heroicons/react/24/outline"; import { CheckIcon } from "@heroicons/react/20/solid"; const Toolbar = () => <><HomeIcon /><CheckIcon /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores type-only and side-effect imports", () => {
    const result = runRule(
      noMixedIconLibraries,
      `import type { LucideIcon } from "lucide-react"; import "@heroicons/react"; const value = 1;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
