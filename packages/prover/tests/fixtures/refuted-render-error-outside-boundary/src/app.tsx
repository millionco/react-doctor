const BrokenPanel = () => {
  throw new Error("panel failed");
};

export const App = () => <BrokenPanel />;
