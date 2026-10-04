// rule: rules-of-hooks
// weakness: name-heuristic
// source: https://github.com/millionco/react-doctor/issues/1797
// verdict: pass
declare const Service: {
  use: (callback: (value: string) => unknown) => unknown;
};
export const fixture = async () => {
  Service.use((value) => value);
};
