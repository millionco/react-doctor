// rule: no-prop-types
// weakness: stale-binding-provenance
// source: adversarial review of component receiver provenance

let Panel: unknown = () => <div />;
Panel = { propTypes: {} };
(Panel as { propTypes: Record<string, () => boolean> }).propTypes = { value: () => true };
