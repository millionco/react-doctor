export const Application = () => {
  const fallbackProperties = {
    onClick: () => undefined,
  };
  const handleClick = () => undefined;
  return (
    <button type="button" {...fallbackProperties} onClick={handleClick}>
      Activate
    </button>
  );
};
