// rule: context-provider-value-from-unmemoized-local-literal
// weakness: provenance
const React = { createContext: () => FakeContext };
const Context = React.createContext(null);

export const App = () => {
  const value = {};
  return <Context value={value} />;
};
