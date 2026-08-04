interface ButtonProperties {
  onClick?: () => void;
}

interface ApplicationProperties {
  fallbackProperties: ButtonProperties;
}

export const Application = ({ fallbackProperties }: ApplicationProperties) => {
  const handleClick = () => undefined;
  return (
    <button type="button" onClick={handleClick} {...fallbackProperties}>
      Activate
    </button>
  );
};
