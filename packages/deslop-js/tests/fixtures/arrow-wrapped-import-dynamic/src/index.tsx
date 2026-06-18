import React, { lazy } from "react";

const Foo = React.lazy(() => import("./Foo"));
const Bar = lazy(() => import("./Bar"));
const Baz = import("./Baz");
const route = {
  path: "feature",
  loadChildren: () => import("./feature.routes"),
};

export { Foo, Bar, Baz, route };
