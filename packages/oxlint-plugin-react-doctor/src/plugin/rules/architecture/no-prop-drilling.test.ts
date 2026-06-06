import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropDrilling } from "./no-prop-drilling.js";

const expectDiagnosticCount = (
  code: string,
  expectedDiagnosticCount: number,
  filename = "fixture.tsx",
): void => {
  const result = runRule(noPropDrilling, code, { filename });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
};

describe("architecture/no-prop-drilling — fail cases", () => {
  it("flags a prop forwarded untouched through three function components", () => {
    expectDiagnosticCount(
      `function Page({ user }) {
  return <Sidebar user={user} />;
}
function Sidebar({ user }) {
  return <Profile user={user} />;
}
function Profile({ user }) {
  return <Avatar user={user} />;
}
function Avatar({ user }) {
  return <img alt={user.name} />;
}`,
      1,
    );
  });

  it("flags a renamed pass-through chain across arrow components", () => {
    expectDiagnosticCount(
      `const Layout = ({ theme }) => <Body palette={theme} />;
const Body = ({ palette }) => <Panel scheme={palette} />;
const Panel = ({ scheme }) => <Swatch value={scheme} />;
const Swatch = ({ value }) => <div className={value} />;`,
      1,
    );
  });

  it("treats a TypeScript cast hop as untouched forwarding", () => {
    expectDiagnosticCount(
      `function A({ payload }) {
  return <B payload={payload} />;
}
function B({ payload }) {
  return <C payload={payload as string} />;
}
function C({ payload }) {
  return <D payload={payload} />;
}
function D({ payload }) {
  return <span>{payload}</span>;
}`,
      1,
    );
  });

  it("reports once at the origin when a prop is forwarded down two branches", () => {
    expectDiagnosticCount(
      `function Page({ user }) {
  return (
    <div>
      <Sidebar user={user} />
      <Footer user={user} />
    </div>
  );
}
function Sidebar({ user }) {
  return <Profile user={user} />;
}
function Profile({ user }) {
  return <Avatar user={user} />;
}
function Avatar({ user }) {
  return <img alt={user.name} />;
}
function Footer({ user }) {
  return <small>{user.name}</small>;
}`,
      1,
    );
  });

  it("names the drilled prop and the chain in the message", () => {
    const result = runRule(
      noPropDrilling,
      `function Page({ user }) {
  return <Sidebar user={user} />;
}
function Sidebar({ user }) {
  return <Profile user={user} />;
}
function Profile({ user }) {
  return <Avatar user={user} />;
}
function Avatar({ user }) {
  return <img alt={user.name} />;
}`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('"user"');
    expect(result.diagnostics[0].message).toContain("Page → Sidebar → Profile");
  });
});

describe("architecture/no-prop-drilling — pass cases", () => {
  it("stays quiet below the depth threshold (two pass-through layers)", () => {
    expectDiagnosticCount(
      `function Page({ user }) {
  return <Sidebar user={user} />;
}
function Sidebar({ user }) {
  return <Profile user={user} />;
}
function Profile({ user }) {
  return <span>{user.name}</span>;
}`,
      0,
    );
  });

  it("does not chain through a component that also reads the prop", () => {
    expectDiagnosticCount(
      `function Page({ user }) {
  return <Sidebar user={user} />;
}
function Sidebar({ user }) {
  console.log(user);
  return <Profile user={user} />;
}
function Profile({ user }) {
  return <Avatar user={user} />;
}
function Avatar({ user }) {
  return <img alt={user.name} />;
}`,
      0,
    );
  });

  it("does not treat a transformed value as untouched forwarding", () => {
    expectDiagnosticCount(
      `function A({ user }) {
  return <B name={user.name} />;
}
function B({ name }) {
  return <C name={name} />;
}
function C({ name }) {
  return <D name={name} />;
}
function D({ name }) {
  return <span>{name}</span>;
}`,
      0,
    );
  });

  it("does not treat a conditionally-selected value as untouched forwarding", () => {
    expectDiagnosticCount(
      `function A({ user }) {
  return <B user={user ? user : null} />;
}
function B({ user }) {
  return <C user={user} />;
}
function C({ user }) {
  return <D user={user} />;
}
function D({ user }) {
  return <span>{user}</span>;
}`,
      0,
    );
  });

  it("resolves bindings by scope, not by name (shadowed map param)", () => {
    expectDiagnosticCount(
      `function Root({ value }) {
  return <Mid value={value} />;
}
function Mid({ value }) {
  return <Inner value={value} />;
}
function Inner({ value }) {
  return <ul>{list.map((value) => <Leaf value={value} />)}</ul>;
}
function Leaf({ value }) {
  return <span>{value}</span>;
}`,
      0,
    );
  });

  it("stops at a component that re-sources the value locally", () => {
    expectDiagnosticCount(
      `function A({ data }) {
  return <B data={data} />;
}
function B({ data }) {
  return <C data={data} />;
}
function C(props) {
  const data = useData();
  return <D data={data} />;
}
function D({ data }) {
  return <span>{data}</span>;
}`,
      0,
    );
  });

  it("does not track spread forwarding (v1 non-goal)", () => {
    expectDiagnosticCount(
      `function A(props) {
  return <B {...props} />;
}
function B(props) {
  return <C {...props} />;
}
function C(props) {
  return <D {...props} />;
}
function D({ user }) {
  return <span>{user.name}</span>;
}`,
      0,
    );
  });

  it("ends the chain when the prop is handed to an imported component", () => {
    expectDiagnosticCount(
      `import { Avatar } from "./avatar";

function Page({ user }) {
  return <Sidebar user={user} />;
}
function Sidebar({ user }) {
  return <Profile user={user} />;
}
function Profile({ user }) {
  return <Avatar user={user} />;
}`,
      0,
    );
  });

  it("terminates on self-recursive components without infinite recursion", () => {
    expectDiagnosticCount(
      `function App({ node }) {
  return <Tree node={node} />;
}
function Tree({ node }) {
  return <Tree node={node} />;
}`,
      0,
    );
  });

  // Regression: a pure-forwarding cycle never consumes the prop, so the
  // cycle-closing hop must not be counted as a terminus (would otherwise
  // manufacture a phantom depth-3 chain from `A → B → C`).
  it("does not report a forwarding cycle that never consumes the prop", () => {
    expectDiagnosticCount(
      `function A({ x }) {
  return <B x={x} />;
}
function B({ x }) {
  return <C x={x} />;
}
function C({ x }) {
  return <B x={x} />;
}`,
      0,
    );
  });

  it("does not report a chain that dead-ends in an infinite self-render", () => {
    expectDiagnosticCount(
      `function A({ x }) {
  return <B x={x} />;
}
function B({ x }) {
  return <Loop x={x} />;
}
function Loop({ x }) {
  return <Loop x={x} />;
}`,
      0,
    );
  });
});
