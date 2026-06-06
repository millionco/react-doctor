import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferExplicitVariants } from "./prefer-explicit-variants.js";

const expectDiagnosticCount = (
  code: string,
  expectedDiagnosticCount: number,
  filename = "fixture.tsx",
): void => {
  const result = runRule(preferExplicitVariants, code, { filename });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
};

describe("architecture/prefer-explicit-variants — fail cases", () => {
  it("flags two boolean props each swapping whole components", () => {
    expectDiagnosticCount(
      `function Composer({ isThread, isEditing }) {
  return (
    <div>
      {isThread ? <ThreadHeader /> : <ChannelHeader />}
      {isEditing ? <EditActions /> : <DefaultActions />}
    </div>
  );
}`,
      1,
    );
  });

  it("flags the arrow-component form", () => {
    expectDiagnosticCount(
      `const Composer = ({ isThread, isEditing }) => (
  <div>
    {isThread ? <ThreadHeader /> : <ChannelHeader />}
    {isEditing ? <EditActions /> : <DefaultActions />}
  </div>
);`,
      1,
    );
  });

  it("flags a negated boolean-prop test", () => {
    expectDiagnosticCount(
      `function Composer({ isEditing, isForwarding }) {
  return (
    <div>
      {!isEditing ? <ReadOnlyBody /> : <EditableBody />}
      {isForwarding ? <ForwardActions /> : <DefaultActions />}
    </div>
  );
}`,
      1,
    );
  });

  it("follows a renamed destructured boolean prop", () => {
    expectDiagnosticCount(
      `function Composer({ isThread: showThread, isEditing }) {
  return (
    <div>
      {showThread ? <ThreadHeader /> : <ChannelHeader />}
      {isEditing ? <EditActions /> : <DefaultActions />}
    </div>
  );
}`,
      1,
    );
  });

  it("follows a defaulted boolean prop", () => {
    expectDiagnosticCount(
      `function Banner({ isPrimary = false, isCompact = false }) {
  return (
    <section>
      {isPrimary ? <PrimaryTitle /> : <SecondaryTitle />}
      {isCompact ? <CompactBody /> : <FullBody />}
    </section>
  );
}`,
      1,
    );
  });

  it("treats JSX fragments as branch output", () => {
    expectDiagnosticCount(
      `function Composer({ isThread, isEditing }) {
  return (
    <div>
      {isThread ? <><ThreadHeader /></> : <><ChannelHeader /></>}
      {isEditing ? <EditActions /> : <DefaultActions />}
    </div>
  );
}`,
      1,
    );
  });

  it("flags parenthesized multi-line ternary arms (the Prettier shape)", () => {
    expectDiagnosticCount(
      `function Composer({ isThread, isEditing }) {
  return (
    <div>
      {isThread ? (
        <ThreadHeader />
      ) : (
        <ChannelHeader />
      )}
      {isEditing ? (
        <EditActions />
      ) : (
        <DefaultActions />
      )}
    </div>
  );
}`,
      1,
    );
  });
});

describe("architecture/prefer-explicit-variants — pass cases (no diagnostics)", () => {
  it("ignores a single boolean-prop component switch", () => {
    expectDiagnosticCount(
      `function Nav({ isMobile, label }) {
  return <div>{isMobile ? <MobileNav /> : <DesktopNav />}{label}</div>;
}`,
      0,
    );
  });

  it("ignores visibility toggles where an arm is null", () => {
    expectDiagnosticCount(
      `function Panel({ isLoading, isOpen }) {
  return (
    <div>
      {isLoading ? <Spinner /> : null}
      {isOpen ? <Body /> : null}
    </div>
  );
}`,
      0,
    );
  });

  it("ignores repeated ternaries on the same single boolean prop", () => {
    expectDiagnosticCount(
      `function Composer({ isThread, title }) {
  return (
    <div>
      {isThread ? <ThreadHeader /> : <ChannelHeader />}
      <h1>{title}</h1>
      {isThread ? <ThreadFooter /> : <ChannelFooter />}
    </div>
  );
}`,
      0,
    );
  });

  it("ignores ternaries on non-boolean-prefixed props", () => {
    expectDiagnosticCount(
      `function View({ status, mode }) {
  return (
    <div>
      {status ? <Active /> : <Inactive />}
      {mode ? <Grid /> : <List />}
    </div>
  );
}`,
      0,
    );
  });

  it("ignores boolean locals that are not props", () => {
    expectDiagnosticCount(
      `import { useState } from "react";

function Composer() {
  const [isThread, setIsThread] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  return (
    <div>
      {isThread ? <ThreadHeader /> : <ChannelHeader />}
      {isEditing ? <EditActions /> : <DefaultActions />}
    </div>
  );
}`,
      0,
    );
  });

  it("ignores ternaries whose arms are not JSX", () => {
    expectDiagnosticCount(
      `function Composer({ isThread, isEditing }) {
  const heading = isThread ? "Thread" : "Channel";
  const action = isEditing ? "Save" : "Send";
  return <div>{heading}{action}</div>;
}`,
      0,
    );
  });

  it("does not descend into nested function branches", () => {
    expectDiagnosticCount(
      `function List({ isThread, isEditing, items }) {
  return (
    <Items
      data={items}
      renderItem={() => (isThread ? <ThreadRow /> : <ChannelRow />)}
      renderFooter={() => (isEditing ? <EditFooter /> : <DefaultFooter />)}
    />
  );
}`,
      0,
    );
  });

  it("ignores non-component functions", () => {
    expectDiagnosticCount(
      `function resolve({ isThread, isEditing }) {
  return isThread ? <ThreadHeader /> : isEditing ? <EditActions /> : <DefaultActions />;
}`,
      0,
    );
  });

  it("ignores cross-cutting state booleans rendered two ways", () => {
    expectDiagnosticCount(
      `function Card({ isLoading, isError }) {
  return (
    <div>
      {isLoading ? <Spinner /> : <Content />}
      {isError ? <ErrorState /> : <OkState />}
    </div>
  );
}`,
      0,
    );
  });

  it("ignores a mode prop paired with a state prop below the threshold", () => {
    expectDiagnosticCount(
      `function Composer({ isThread, isLoading }) {
  return (
    <div>
      {isThread ? <ThreadHeader /> : <ChannelHeader />}
      {isLoading ? <Spinner /> : <Body />}
    </div>
  );
}`,
      0,
    );
  });
});
