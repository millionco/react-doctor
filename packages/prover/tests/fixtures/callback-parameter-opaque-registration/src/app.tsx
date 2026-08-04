const scheduleCallback = (callback: () => void) => {
  setTimeout(callback, 0);
};

const recordSelection = () => {};

export const App = () => {
  const handleClick = () => scheduleCallback(recordSelection);
  return (
    <button type="button" onClick={handleClick}>
      Select
    </button>
  );
};
