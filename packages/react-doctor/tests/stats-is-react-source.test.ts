import { describe, expect, it } from "vite-plus/test";
import { isReactSourceFile } from "../src/stats/is-react-source.js";

describe("isReactSourceFile", () => {
  it("treats JSX extensions as React regardless of content", () => {
    expect(isReactSourceFile("/repo/src/App.tsx", "export const App = () => null;")).toBe(true);
    expect(isReactSourceFile("/repo/src/widget.jsx", "module.exports = {};")).toBe(true);
  });

  it("detects React via direct and ecosystem imports in .ts/.js files", () => {
    expect(isReactSourceFile("/repo/src/useThing.ts", 'import { useState } from "react";')).toBe(
      true,
    );
    expect(
      isReactSourceFile("/repo/src/data.ts", 'import { useQuery } from "@tanstack/react-query";'),
    ).toBe(true);
    expect(
      isReactSourceFile(
        "/repo/src/nav.ts",
        'import { useNavigation } from "@react-navigation/native";',
      ),
    ).toBe(true);
    expect(isReactSourceFile("/repo/src/page.ts", 'const r = require("react-dom/server");')).toBe(
      true,
    );
  });

  it("detects React Server Component / server-action directives", () => {
    expect(
      isReactSourceFile("/repo/src/actions.ts", '"use server";\nexport async function go() {}'),
    ).toBe(true);
    expect(isReactSourceFile("/repo/src/client.ts", "'use client'\nexport const x = 1;")).toBe(
      true,
    );
  });

  it("rejects plain backend / util / config files", () => {
    expect(isReactSourceFile("/repo/src/math.ts", "export const add = (a, b) => a + b;")).toBe(
      false,
    );
    expect(
      isReactSourceFile(
        "/repo/server/db.ts",
        'import { Pool } from "pg";\nexport const pool = new Pool();',
      ),
    ).toBe(false);
    expect(isReactSourceFile("/repo/scripts/build.js", 'const fs = require("node:fs");')).toBe(
      false,
    );
  });

  it("does not mistake unrelated specifiers containing other words for React", () => {
    expect(isReactSourceFile("/repo/src/a.ts", 'import x from "reactor-core";')).toBe(false);
    expect(isReactSourceFile("/repo/src/b.ts", 'import y from "overreact";')).toBe(false);
  });
});
