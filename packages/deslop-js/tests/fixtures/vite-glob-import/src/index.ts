const modules = import.meta.glob("./modules/*.ts");
const layouts = import.meta.glob(["./layouts/*.ts", "./modules/*.ts"]);
export { modules, layouts };
