interface ButtonProperties {
  onClick?: () => void;
}

export const Application = () => {
  const handleExplicitClick = () => undefined;
  const spreadProperties: ButtonProperties = {
    onClick: () => undefined,
  };
  return (
    <button type="button" onClick={handleExplicitClick} {...spreadProperties}>
      Activate
    </button>
  );
};
