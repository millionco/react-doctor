import { createContext, useContext } from "react";

const ProviderContext = createContext("provider-default");
const ConsumerContext = createContext("consumer-default");

const Consumer = () => {
  const value = useContext(ConsumerContext);
  return <output>{value}</output>;
};

export const App = () => (
  <ProviderContext.Provider value="provided">
    <Consumer />
  </ProviderContext.Provider>
);
