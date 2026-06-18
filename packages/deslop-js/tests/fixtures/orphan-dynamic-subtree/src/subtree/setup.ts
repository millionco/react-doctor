// Dead root that dynamically imports a child module.
const lazyModule = import("./lazy");

console.log(lazyModule);

export const setup = (): string => "setup";
