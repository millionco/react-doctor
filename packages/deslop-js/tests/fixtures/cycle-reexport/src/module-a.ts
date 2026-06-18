// module-a has its own export and re-exports from module-b
export const fromA = "defined in module-a";
export { fromB } from "./module-b";
