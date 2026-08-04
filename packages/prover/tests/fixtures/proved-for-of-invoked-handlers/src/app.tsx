const firstHandler = () => undefined;
const secondHandler = () => undefined;

export const Application = () => {
  const handleClick = () => {
    for (const handler of [firstHandler, secondHandler]) {
      handler();
    }
  };
  return (
    <button type="button" onClick={handleClick}>
      Activate
    </button>
  );
};
