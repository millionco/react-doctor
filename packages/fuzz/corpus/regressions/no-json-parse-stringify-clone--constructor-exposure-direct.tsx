(() => {}).constructor("global = {}")();
global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
