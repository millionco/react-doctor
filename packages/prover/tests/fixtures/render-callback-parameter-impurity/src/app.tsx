const invokeCallback = (callback: () => number) => callback();

const readCurrentValue = () => {
  console.log("reading current value");
  return 1;
};

export const App = () => {
  const value = invokeCallback(readCurrentValue);
  return <p>{value}</p>;
};
