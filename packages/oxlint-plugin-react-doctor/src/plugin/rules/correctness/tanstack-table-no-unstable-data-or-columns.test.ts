import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackTableNoUnstableDataOrColumns } from "./tanstack-table-no-unstable-data-or-columns.js";

describe("tanstack-table-no-unstable-data-or-columns", () => {
  it("reports inline data and columns arrays", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useReactTable, getCoreRowModel } from "@tanstack/react-table";
       const Table = ({ users }) => {
         const table = useReactTable({
           data: [],
           columns: [{ accessorKey: "name" }],
           getCoreRowModel: getCoreRowModel(),
         });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports render-scoped const arrays and inline transformations", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useReactTable } from "@tanstack/react-table";
       const Table = ({ rows }) => {
         const columns = [{ accessorKey: "name" }];
         const table = useReactTable({
           columns,
           data: rows.filter((row) => row.isActive),
         });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports fresh fallback arrays behind nullish and ternary branches", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useTable } from "@tanstack/react-table";
       const Table = ({ rows, isReady, columns }) => {
         const table = useTable({
           data: rows ?? [],
           columns: isReady ? columns : [],
         });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts memoized, state-backed, prop, and module-scope references", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useMemo, useState } from "react";
       import { useReactTable } from "@tanstack/react-table";
       const fallbackData = [];
       const Table = ({ rows }) => {
         const columns = useMemo(() => [{ accessorKey: "name" }], []);
         const [data] = useState(() => []);
         const filtered = useMemo(() => rows.filter((row) => row.isActive), [rows]);
         useReactTable({ data, columns });
         useReactTable({ data: filtered, columns });
         useReactTable({ data: rows ?? fallbackData, columns });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores same-named hooks from other modules and non-hook calls", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useReactTable } from "./my-table";
       const useTable = (options) => options;
       const Table = () => {
         useReactTable({ data: [], columns: [] });
         useTable({ data: [], columns: [] });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("leaves other options and spread options alone", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useReactTable } from "@tanstack/react-table";
       const Table = ({ options, data, columns }) => {
         useReactTable({ ...options, data, columns, initialState: { sorting: [] } });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
