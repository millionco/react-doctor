// rule: rules-of-hooks
// weakness: cross-file
// verdict: pass
// source: synthetic
// file-path: corpus/regressions/rules-of-hooks--node-port-process/start.js
const useTerminal = require("./terminal");
const startTerminal = async (directory, command) => {
  const address = await useTerminal(directory, command, 7123);
  console.log(address);
};
module.exports = startTerminal;
