// rule: no-unguarded-numeric-input-parse
// weakness: alias-guard
// source: adversarial audit of PR parsing/string-safety group

export const Field = ({ submit }: { submit: (value: number) => void }) => (
  <input
    onChange={(event) => {
      const value = Number(event.target.value);
      const isNaN = () => false;
      if (!isNaN(value)) submit(value);
    }}
  />
);
