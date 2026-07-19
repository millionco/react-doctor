// rule: no-whole-object-default-losing-per-key-defaults
// weakness: control-flow
export const isDisabled = ({ enabled }: { enabled?: boolean } = { enabled: false }) =>
  enabled === false;
