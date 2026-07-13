export const UnnamedIconButton = ({ onActivate }: { onActivate: () => void }) => (
  <button type="button" onClick={onActivate}>
    <svg aria-hidden="true" />
  </button>
);
