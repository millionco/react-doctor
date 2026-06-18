// module-b has its own export and re-exports from module-a (circular)
export const fromB = "defined in module-b";
export { fromA } from "./module-a";
