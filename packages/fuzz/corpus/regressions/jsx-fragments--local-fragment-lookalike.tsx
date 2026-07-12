// rule: jsx-fragments
// weakness: binding-provenance
// source: ISSUES_TO_FIX_ASAP.md Fragment lookalike report
const Fragment = ({ children }: { children: React.ReactNode }) => <section>{children}</section>;

export const Preview = () => (
  <Fragment>
    <span />
  </Fragment>
);
