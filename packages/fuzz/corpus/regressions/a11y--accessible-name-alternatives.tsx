// rule: anchor-has-content, heading-has-content, no-noninteractive-element-interactions
// weakness: name-heuristic
// source: FP-FIX(a11y) history (accessible names via aria-*, aria-hidden interactivity)
export const NamedAnchor = () => <a href="/profile" aria-labelledby="profile-label" />;
export const NamedHeading = () => <h1 aria-label="Dashboard" />;
export const HiddenInteractive = () => (
  <li aria-hidden="true" onClick={() => {}}>
    decorative
  </li>
);
export const LabelWrapper = ({
  onChange,
  src,
}: {
  onChange?: (theme: string) => void;
  src: string;
}) => (
  <label onClick={() => onChange?.("dark")}>
    <input type="radio" name="theme" />
    <img draggable={false} src={src} alt="theme" />
  </label>
);
export const ShippingAutocomplete = () => (
  <input type="text" name="zip" autoComplete="shipping postal-code" />
);
