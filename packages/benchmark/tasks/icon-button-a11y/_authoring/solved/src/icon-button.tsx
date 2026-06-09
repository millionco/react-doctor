export interface IconButtonProps {
  label: string;
  glyph: string;
  onPress: () => void;
}

export const IconButton = ({ label, glyph, onPress }: IconButtonProps) => (
  <button type="button" aria-label={label} onClick={onPress} className="icon-button">
    <span aria-hidden="true">{glyph}</span>
  </button>
);
