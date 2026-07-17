// rule: no-low-contrast-inline-style
// weakness: computed style key can override a statically analyzed color
// source: automated review on PR #1337

interface ComputedStyleProps {
  propertyName: string;
  value: string;
}

export const ComputedStyle = ({ propertyName, value }: ComputedStyleProps) => (
  <span
    style={{
      color: "#9ca3af",
      backgroundColor: "#fff",
      fontSize: 16,
      [propertyName]: value,
    }}
  >
    Account status
  </span>
);
