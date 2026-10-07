// rule: only-export-components
// weakness: framework-gating
// source: 0.8.1-to-main all-rules parity audit
// verdict: fail

declare const z: {
  object: (shape: unknown) => unknown;
  string: () => unknown;
};

export const UsernameSchema = z.object({ username: z.string() });
export const meta = () => [{ title: "Settings" }];

export default function Settings() {
  return <div />;
}
