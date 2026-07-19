// rule: rn-detox-missing-await
// weakness: promise-handling
export const runDetoxAction = () => {
  element(by.id("submit")).tap().finally(cleanup);
};
