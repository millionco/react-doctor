const propertyName = "constructor";
const { [propertyName]: execute } = () => {};
execute("global = {}")();
global.structuredClone = (value) => JSON.parse(JSON.stringify(value));
