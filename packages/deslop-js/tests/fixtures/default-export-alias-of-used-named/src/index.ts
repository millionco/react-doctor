const load = () => import("./devtools").then((m) => ({ default: m.Page }));

console.log(load);
