// rule: server-no-mutable-module-state
// weakness: name-heuristic
// source: PR #1180

"use server";

const state = Object.seal({ service: getService() });

export const update = async () => {
  state.service.set("status", "active");
};
