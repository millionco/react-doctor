// rule: no-placeholder-only-field
// weakness: control-flow
// source: final adversarial review
// verdict: fail

interface EmailFieldProps {
  readonly showLabel: boolean;
}

export const EmailField = ({ showLabel }: EmailFieldProps) =>
  showLabel ? (
    <label htmlFor="email">Email</label>
  ) : (
    <input id="email" placeholder="name@example.com" />
  );
