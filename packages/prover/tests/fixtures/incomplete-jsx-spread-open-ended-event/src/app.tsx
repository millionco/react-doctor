interface ApplicationProperties {
  fallbackProperties: Record<string, unknown>;
}

export const Application = ({ fallbackProperties }: ApplicationProperties) => {
  const handleClick = () => undefined;
  return (
    <button type="button" onClick={handleClick} {...fallbackProperties}>
      Activate
    </button>
  );
};
