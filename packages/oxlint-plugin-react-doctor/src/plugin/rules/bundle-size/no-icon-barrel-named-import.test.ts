import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noIconBarrelNamedImport } from "./no-icon-barrel-named-import.js";

describe("no-icon-barrel-named-import", () => {
  it("flags a namespace import from the barrel", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import * as Icons from '@mui/icons-material';`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("@mui/icons-material/Download");
  });

  it("flags a namespace import from @ant-design/icons", () => {
    const result = runRule(noIconBarrelNamedImport, `import * as Icons from '@ant-design/icons';`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a namespace re-export of the barrel", () => {
    const result = runRule(noIconBarrelNamedImport, `export * as Icons from '@material-ui/icons';`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a tree-shaken named import (MUI docs idiom, Next.js optimizePackageImports)", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import { Download } from '@mui/icons-material';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the aliased named-import idiom (`OpenInNew as OpenInNewIcon`)", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import { OpenInNew as OpenInNewIcon } from '@mui/icons-material';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag multi-icon named imports (sideEffects:false ESM barrels tree-shake)", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import { Remove, PlusOne } from '@material-ui/icons';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag @ant-design/icons named imports (officially documented form)", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import { HomeOutlined } from '@ant-design/icons';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a named re-export icon index module (tree-shaken like named imports)", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `export { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a star re-export without a namespace alias", () => {
    const result = runRule(noIconBarrelNamedImport, `export * from '@mui/icons-material';`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a type-only namespace import", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import type * as Icons from '@mui/icons-material';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the deep default import", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import Download from '@mui/icons-material/Download';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a type-only declaration", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import type { SvgIconComponent } from '@mui/icons-material';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag namespace imports from tree-shakeable non-icon barrels", () => {
    const result = runRule(noIconBarrelNamedImport, `import * as Mui from '@mui/material';`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag react-icons subpaths", () => {
    const result = runRule(noIconBarrelNamedImport, `import { FaBeer } from 'react-icons/fa';`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag deep @ant-design/icons subpath imports", () => {
    const result = runRule(
      noIconBarrelNamedImport,
      `import HomeOutlined from '@ant-design/icons/HomeOutlined';`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
