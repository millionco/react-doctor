// rule: server-no-mutable-module-state
// weakness: control-flow
// source: PR #1180

"use server";

const state = Object.seal({
  get count() {
    return 0;
  },
});

export const increment = async () => {
  state.count++;
};
