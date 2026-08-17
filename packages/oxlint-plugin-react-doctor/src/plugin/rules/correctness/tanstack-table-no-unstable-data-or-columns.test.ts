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

  it("suppresses allocating method names on proven custom objects", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useReactTable } from "@tanstack/react-table";
       const stableData = [];
       const cache = { filter: () => stableData };
       const Table = () => useReactTable({ data: cache.filter(), columns: [] });`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("columns");
  });

  it("reports allocating methods on typed table inputs", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useReactTable, type ColumnDef } from "@tanstack/react-table";
       interface TableProps { columns: ReadonlyArray<ColumnDef<unknown>>; data: ReadonlyArray<unknown> }
       const Table = ({ columns, data }: TableProps) =>
         useReactTable({
           data: data ?? [],
           columns: columns.map((column) => ({ ...column })),
         });`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("resolves table hook aliases and namespace imports without matching shadows", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import * as TableApi from "@tanstack/react-table";
       import { useReactTable } from "@tanstack/react-table";
       const aliasedHook = useReactTable;
       const FalsePositive = () => {
         const useReactTable = (options) => options;
         return useReactTable({ data: [], columns: [] });
       };
       const Table = () => {
         TableApi.useReactTable({ data: [], columns: [] });
         aliasedHook({ data: [], columns: [] });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("checks render-scoped options and fresh values behind local aliases", () => {
    const result = runRule(
      tanstackTableNoUnstableDataOrColumns,
      `import { useReactTable } from "@tanstack/react-table";
       const sharedColumns = [];
       const Table = ({ rows, ready, columnMap }) => {
         const data = rows ?? [];
         const columns = ready ? sharedColumns : [];
         const options = { data, columns };
         useReactTable(options);
         useReactTable({
           data: Array.from(rows),
           columns: Object.values(columnMap),
         });
         return null;
       };`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });
});
