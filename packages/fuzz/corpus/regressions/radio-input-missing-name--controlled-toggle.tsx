// rule: radio-input-missing-name
// weakness: library-idiom
// source: PR #1000 adversarial review (React state owns exclusivity)
export const Toggle = ({ isOn, onToggle }: { isOn: boolean; onToggle: () => void }) => (
  <input type="radio" checked={isOn} onChange={onToggle} />
);

export const Choices = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) => (
  <div>
    {["a", "b", "c"].map((option) => (
      <input
        key={option}
        type="radio"
        value={option}
        checked={value === option}
        onChange={() => onChange(option)}
      />
    ))}
  </div>
);
