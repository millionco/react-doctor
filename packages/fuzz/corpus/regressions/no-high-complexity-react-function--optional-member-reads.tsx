// rule: no-high-complexity-react-function
// verdict: pass
// weakness: control-flow
// source: PR #1624 Daytona parity audit

interface Defaults {
  section?: {
    first?: { label?: string };
    second?: { label?: string };
    third?: { label?: string };
    fourth?: { label?: string };
    fifth?: { label?: string };
    sixth?: { label?: string };
  };
}

export const LinearSettingsForm = ({ defaults }: { defaults?: Defaults }) => (
  <form>
    <output>{defaults?.section?.first?.label}</output>
    <output>{defaults?.section?.second?.label}</output>
    <output>{defaults?.section?.third?.label}</output>
    <output>{defaults?.section?.fourth?.label}</output>
    <output>{defaults?.section?.fifth?.label}</output>
    <output>{defaults?.section?.sixth?.label}</output>
  </form>
);
