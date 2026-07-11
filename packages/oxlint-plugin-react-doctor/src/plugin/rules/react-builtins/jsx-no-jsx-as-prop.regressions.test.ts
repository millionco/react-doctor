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

  // Prod telemetry review 2026-07: 40/40 corpus hits were slot-shaped
  // props on imported (memo-unknown) components — lobe-ui `messageExtra`,
  // refine `trailing`/`loading`/`empty`, ant-design `headerRow`/
  // `pagination`, novu `tools`, etc. The perf claim is only real when
  // the consumer is provably memoised, so unknown receivers stay quiet.
  it("does not flag inline JSX passed to a non-slot prop on a (memo-unknown) imported component", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `const View = () => <Imported widget={<Heavy />}>{rows}</Imported>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag corpus-mined JSX slots on imported components (lobe-ui/refine/novu shapes)", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { ChatItem } from '@lobehub/ui';
      import { ListTitle } from './list-title';
      const View = ({ data }) => (
        <>
          <ChatItem messageExtra={<MessageExtra data={data} />} />
          <ListTitle trailing={<Badge count={data.length} />} empty={<EmptyState />} />
        </>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag the corpus MUI ListItemText primary slot", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import ListItemText from "@mui/material/ListItemText";
      import { FormattedMessage } from "react-intl";
      const Row = () => <ListItemText primary={<FormattedMessage id="row.title" />} />;
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
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

  // Fuzz FP hunt (corpus census 2026-07): material-ui `ListItem
  // leftAvatar/primaryText/secondaryText`, supabase `ChartContent
  // loadingState/disabledState`, leemons `leftZone/rightZone`, and the
  // capitalised exact slot `Footer={<PageFooter />}` — all conventional
  // JSX slots the suffix/name tables missed.
  it("does not flag corpus-mined slot props (Avatar/Text/State/Zone suffixes, capitalised Footer)", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      const View = () => (
        <>
          <ListItem leftAvatar={<Avatar src={user.image} />} primaryText={<b>{user.name}</b>} secondaryText={<i>{user.bio}</i>} />
          <ChartContent loadingState={<ChartLoadingState />} disabledState={<ChartDisabledState />} />
          <FooterContainer leftZone={<BackButton />} rightZone={<NextButton />} />
          <StepContainer Footer={<PageFooter />} />
          <AuthenticationMethodCard config={<ToggleSwitch value={enabled} />} />
        </>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
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

const INK_STATUS_BAR_USAGE = `
  const keyHints = isMenuOpen ? (
    <>
      <Text dimColor>{"up/down select · "}</Text>
      <Text color="cyan">enter</Text>
      <Text dimColor>{" run · esc close"}</Text>
    </>
  ) : (
    <>
      <Text dimColor>{"up/down move · "}</Text>
      <Text color="cyan">enter</Text>
      <Text dimColor>{" fix this"}</Text>
    </>
  );
  return (
    <Box marginTop={1}>
      <StatusBar total={12} unreadCount={3} keyHints={keyHints} exitHint="q quit" />
    </Box>
  );
`;

describe("jsx-no-jsx-as-prop regressions", () => {
  it("does not flag JSX passed to a same-file component that is provably not memoized (ink TUI regression)", () => {
    const code = `
import { Box, Text } from "ink";
const StatusBar = ({ total, unreadCount, keyHints, exitHint }) => (
  <Text>
    {total} issues, {unreadCount} unread {keyHints} {exitHint}
  </Text>
);
const DiagnosticList = ({ isMenuOpen }) => {
${INK_STATUS_BAR_USAGE}
};
`;
    const result = runRule(jsxNoJsxAsProp, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps the assertive message when the same-file receiver is wrapped in memo()", () => {
    const code = `
import { memo } from "react";
import { Box, Text } from "ink";
const StatusBar = memo(({ total, unreadCount, keyHints, exitHint }) => (
  <Text>
    {total} issues, {unreadCount} unread {keyHints} {exitHint}
  </Text>
));
const DiagnosticList = ({ isMenuOpen }) => {
${INK_STATUS_BAR_USAGE}
};
`;
    const result = runRule(jsxNoJsxAsProp, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toBe(
      "This child redraws every render because the prop gets brand new JSX each time.",
    );
  });

  it("does not flag when the same-file receiver is lazy() — lazy does not memoize (chartdb regression)", () => {
    const code = `
import { lazy } from "react";
import { Box, Text } from "ink";
const StatusBar = lazy(() => import("./status-bar.js"));
const DiagnosticList = ({ isMenuOpen }) => {
${INK_STATUS_BAR_USAGE}
};
`;
    const result = runRule(jsxNoJsxAsProp, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the receiver is imported (memo status unknown)", () => {
    const code = `
import { Box, Text } from "ink";
import { StatusBar } from "./status-bar.js";
const DiagnosticList = ({ isMenuOpen }) => {
${INK_STATUS_BAR_USAGE}
};
`;
    const result = runRule(jsxNoJsxAsProp, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // docs-validation 2026-07 FP corpus: every sampled hit passed inline JSX
  // (or a JSX-defaulted binding) to an UNMEMOIZED consumer — a same-file
  // plain function (`ProcessNode meta={...}`) or an imported component
  // (internxt Dropdown, recharts Scatter, ebay EbayIcon). With no memo
  // boundary to defeat, fresh JSX identity costs nothing.
  it("does not flag conditional inline JSX on a same-file unmemoized component (ProcessNode shape)", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      const ProcessNode = ({ meta, label }) => (
        <div>
          {label}
          {meta}
        </div>
      );
      const ProcessFlow = ({ isActive }) => (
        <ProcessNode label="step" meta={isActive ? <ActiveMeta /> : null} />
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  // docs-validation 2026-07 docMismatch (ebay education-notice): a
  // parameter binding DEFAULTED to JSX and forwarded to a prop must not
  // fire on an imported consumer — the flagged `name={educationIcon}`
  // usually carries a string, and EbayIcon's memo status is unknown.
  it("does not flag a JSX-defaulted parameter forwarded to an imported component (ebay shape)", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import EbayIcon from "../ebay-icon/icon";
      import { EbayIconLightbulb24 } from "../ebay-icon/icons/ebay-icon-lightbulb-24";
      const EbayEducationNotice = ({
        educationIcon = <EbayIconLightbulb24 />,
        iconClass,
      }) => (
        <section>
          {typeof educationIcon === "string" ? (
            <EbayIcon name={educationIcon} className={iconClass} />
          ) : (
            educationIcon
          )}
        </section>
      );
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("exempts same-file memoized props typed as React JSX slots while reporting a non-slot prop", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import React, { memo, type ReactNode } from "react";
      interface ChildProps {
        payload: ReactNode;
        visual: React.ReactElement;
        artifact: JSX.Element | null;
        strictValue: string;
      }
      const MemoChild = memo(
        ({ payload, visual, artifact, strictValue }: ChildProps) => (
          <section>{payload}{visual}{artifact}{strictValue}</section>
        ),
      );
      const Parent = () => (
        <MemoChild
          payload={<Heavy />}
          visual={<Chart />}
          artifact={<Badge />}
          strictValue={<Incorrect />}
        />
      );
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("brand new JSX");
  });

  it("resolves memo references to same-file component implementations", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { memo, type ReactNode } from "react";
      interface ChildProps {
        payload: ReactNode;
      }
      const ChildImplementation = ({ payload }: ChildProps) => <>{payload}</>;
      const MemoChild = memo(ChildImplementation);
      const Parent = () => <MemoChild payload={<Heavy />} />;
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the JSX component binding when applying same-file slot contracts", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { memo, type ReactNode } from "react";
      const MemoChild = memo(({ payload }: { payload: ReactNode }) => <>{payload}</>);
      const Parent = () => {
        const MemoChild = memo(
          ({ payload }: { payload: unknown }) => <span>{String(payload)}</span>,
        );
        return <MemoChild payload={<Heavy />} />;
      };
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("brand new JSX");
  });

  it("does not treat arbitrary wrappers as transparent component contracts", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { memo, type ReactNode } from "react";
      interface ChildProps {
        payload: ReactNode;
      }
      const adapt = (render: (props: ChildProps) => JSX.Element) =>
        ({ payload }: { payload: unknown }) => render({ payload: String(payload) });
      const MemoChild = memo(adapt(({ payload }: ChildProps) => <>{payload}</>));
      const Parent = () => <MemoChild payload={<Heavy />} />;
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("brand new JSX");
  });

  it("resolves renamed React slot type imports and same-file type aliases", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { memo, type ReactElement as ElementSlot, type ReactNode as NodeSlot } from "react";
      type OptionalSlot = NodeSlot | undefined;
      type ChildProps = {
        payload: ElementSlot;
        artifact: OptionalSlot;
      };
      const MemoChild = memo(({ payload, artifact }: ChildProps) => <>{payload}{artifact}</>);
      const Parent = () => <MemoChild payload={<Heavy />} artifact={<Badge />} />;
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust imported props or a same-file JSX namespace", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { memo } from "react";
      import type { ChildProps } from "./child-props";
      namespace JSX {
        export interface Element {}
      }
      interface LocalJsxChildProps {
        payload: JSX.Element;
      }
      const ImportedTypedChild = memo(({ payload }: ChildProps) => <>{payload}</>);
      const LocalJsxTypedChild = memo(({ payload }: LocalJsxChildProps) => <>{payload}</>);
      const Parent = () => (
        <>
          <ImportedTypedChild payload={<Heavy />} />
          <LocalJsxTypedChild payload={<Heavy />} />
        </>
      );
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not mistake a same-file ReactNode namesake for React's slot type", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `
      import { memo } from "react";
      type ReactNode = string;
      interface ChildProps {
        payload: ReactNode;
      }
      const MemoChild = memo(({ payload }: ChildProps) => <>{payload}</>);
      const Parent = () => <MemoChild payload={<Heavy />} />;
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
