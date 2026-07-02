import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoJsxAsProp } from "./jsx-no-jsx-as-prop.js";

describe("react-builtins/jsx-no-jsx-as-prop regressions", () => {
  // `separator` is a canonical layout slot — `<Join separator={<Spacer />}>`,
  // `<Stack separator={<Divider />}>` — on children-taking layout primitives
  // that never memoize. The inline element is the intended API, not a footgun.
  it("does not flag a `separator` slot receiving inline JSX", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `const View = () => <Join separator={<Spacer y={4} />}>{rows}</Join>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a `divider` slot receiving inline JSX", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `const View = () => <Stack divider={<Divider />}>{rows}</Stack>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags inline JSX passed to a non-slot prop on a (memo-unknown) imported component", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `const View = () => <Imported widget={<Heavy />}>{rows}</Imported>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // Mined ant-design FP (.dumi/pages/index/index.tsx:92):
  // `<Group decoration={<img .../>}>` — a background-decoration slot.
  it("does not flag a `decoration` slot receiving inline JSX", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import Group from './components/Group';
      const Homepage = () => (
        <Group
          title={locale.designTitle}
          decoration={<img draggable={false} src="https://example.com/bg.svg" alt="bg" />}
        >
          <Content />
        </Group>
      );
      `,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // Mined ant-design FP (.dumi/pages/index/components/PreviewPane/Simple.tsx:206):
  // antd Switch's `checkedChildren` / `unCheckedChildren` — the `*Children`
  // suffix marks a slot by convention.
  it("does not flag `checkedChildren`/`unCheckedChildren` slots on antd Switch", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { Switch } from 'antd';
      import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
      const Demo = () => (
        <Switch
          defaultChecked
          checkedChildren={<CheckOutlined />}
          unCheckedChildren={<CloseOutlined />}
          style={{ width: 48 }}
        />
      );
      `,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // Mined ant-design FP (.dumi/pages/index/components/PreviewPane/Components.tsx:376):
  // antd Spin's lowercase `indicator` — the case-sensitive `Indicator` suffix
  // never matched it, so it needs the explicit slot-name entry.
  it("does not flag an `indicator` slot on antd Spin", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { Spin } from 'antd';
      import { LoadingOutlined } from '@ant-design/icons';
      const Demo = () => <Spin indicator={<LoadingOutlined spin />} size="middle" />;
      `,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
