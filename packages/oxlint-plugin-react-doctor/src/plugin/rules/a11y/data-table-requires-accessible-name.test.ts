import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { dataTableRequiresAccessibleName } from "./data-table-requires-accessible-name.js";

describe("data-table-requires-accessible-name", () => {
  it("reports a header-bearing table without a name", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Ada</td></tr></tbody></table>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows captions and ARIA names", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table><caption>Results</caption><tr><th>Name</th></tr></table><table aria-labelledby="results-title"><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a caption wrapped in a transparent fragment and a fallback title", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table><><caption>Results</caption></><tr><th>Name</th></tr></table><table title="Results"><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports empty naming attributes and captions", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table aria-label=""><tr><th>Name</th></tr></table><table aria-labelledby="   "><tr><th>Name</th></tr></table><table title={null}><tr><th>Name</th></tr></table><table><caption>   </caption><tr><th>Name</th></tr></table><table><caption>{false}{" "}</caption><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("reports a caption hidden from assistive technology", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <table><caption aria-hidden="true">Results</caption><tr><th>Name</th></tr></table>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips hidden tables and tables whose only headers are hidden", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table hidden><tr><th>Name</th></tr></table><table aria-hidden="true"><tr><th>Name</th></tr></table><table><tr><th hidden>Name</th></tr></table><table><thead hidden><tr><th>Name</th></tr></thead></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips tables inside hidden subtrees", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <div hidden><table><tr><th>Name</th></tr></table></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses actual caption text alternatives instead of element presence", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table><caption><img alt="Results" /></caption><tr><th>Name</th></tr></table><table><caption><span><i /></span></caption><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses authoritative caption text-alternative attributes", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = ({ props }) => <><table><caption><img alt="Results" alt="" /></caption><tr><th>Name</th></tr></table><table><caption><img {...props} alt="" /></caption><tr><th>Name</th></tr></table><table><caption><img {...{ className: "icon" }} alt="" /></caption><tr><th>Name</th></tr></table><table><caption children="Results" children={null} /><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports captions whose descendants are all hidden or empty", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table><caption><span hidden>Results</span></caption><tr><th>Name</th></tr></table><table><caption><img alt={null} /></caption><tr><th>Name</th></tr></table><table><caption><span aria-hidden={1}>Results</span></caption><tr><th>Name</th></tr></table><table><caption><span children={null} /></caption><tr><th>Name</th></tr></table><table><caption>{void 0}</caption><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("accepts visible content when aria-hidden is statically false", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <table><caption><span aria-hidden="false">Results</span></caption><tr><th>Name</th></tr></table>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts React-stringified boolean ARIA names", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <table aria-label={false}><tr><th>Name</th></tr></table>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips a dynamic role that may make the table presentational", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = ({ role }) => <table role={role}><tr><th>Name</th></tr></table>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports a role value that React omits", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <table role={null}><tr><th>Name</th></tr></table>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the first recognized explicit role", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table role="button"><tr><th>Name</th></tr></table><table role="foo presentation"><tr><th>Name</th></tr></table><table role="presentation none"><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps explicit data table roles in scope", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table role="table presentation"><tr><th>Name</th></tr></table><table role="foo grid button"><tr><th>Name</th></tr></table><table role="treegrid"><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not treat a nested table header as belonging to its outer table", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <table><tbody><tr><td><table aria-label="Results"><tr><th>Name</th></tr></table></td></tr></tbody></table>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips layout, spread-owned, headerless, and custom tables", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = ({ props }) => <><table role="presentation"><tr><th>Name</th></tr></table><table {...props}><tr><th>Name</th></tr></table><table><tr><td>Ada</td></tr></table><Table><th>Name</th></Table></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports through fully static irrelevant spreads and const aliases", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const base = { className: "results" };
       const aliased = base;
       const Results = () => <><table {...{ id: "results", ...{ "data-kind": "report" } }}><tr><th>Name</th></tr></table><table {...aliased}><tr><th>Name</th></tr></table><table {...{ CLASSNAME: "results" }}><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("resolves static spread semantics while preserving dynamic uncertainty", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const props = { className: "results" };
       const Dynamic = ({ props, propertyName }) => <><table {...props}><tr><th>Name</th></tr></table><table {...{ [propertyName]: "Results" }}><tr><th>Name</th></tr></table><table {...{ "ARIA-LABEL": "Results" }}><tr><th>Name</th></tr></table><table {...{ hidden: false }}><tr><th>Name</th></tr></table><table {...{ children: null }}><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("honors source order when explicit attributes override static spread semantics", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table {...{ role: "presentation", "aria-label": "Results" }} role="table" aria-label=""><tr><th>Name</th></tr></table><table role="table" aria-label="" {...{ role: "presentation" }}><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves table semantics supplied by ordered static object spreads", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table {...{ role: "table", "aria-label": "" }}><tr><th>Name</th></tr></table><table {...{ role: "presentation" }}><tr><th>Name</th></tr></table><table {...{ "aria-label": "Results" }}><tr><th>Name</th></tr></table><table {...{ hidden: false, role: null }}><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips tables rasterized by an imported ImageResponse", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `import { ImageResponse } from "next/og";
       export const GET = () => new ImageResponse(<table><tr><th>Name</th></tr></table>);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
