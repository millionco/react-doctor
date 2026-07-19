// rule: no-unguarded-numeric-input-parse
// weakness: control-flow
// source: adversarial audit of PR parsing/string-safety group

export const Field = ({ submit }: { submit: (value: number) => void }) => (
  <input
    onChange={(event) => {
      const value = Number(event.target.value);
      submit(value);
      if (Number.isNaN(value)) return;
    }}
  />
);
