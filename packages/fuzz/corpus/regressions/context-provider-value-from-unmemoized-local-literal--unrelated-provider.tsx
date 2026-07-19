// rule: context-provider-value-from-unmemoized-local-literal
// weakness: provenance
import { Fake } from "./fake";

export const App = () => {
  const value = {};
  return <Fake.Provider value={value} />;
};
