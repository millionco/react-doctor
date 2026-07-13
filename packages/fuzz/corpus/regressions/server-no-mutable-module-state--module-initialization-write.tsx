// rule: server-no-mutable-module-state
// weakness: control-flow
// source: PR #1180

"use server";

const state = Object.seal({ count: 0 });
state.count = 1;

export const read = async () => state.count;
