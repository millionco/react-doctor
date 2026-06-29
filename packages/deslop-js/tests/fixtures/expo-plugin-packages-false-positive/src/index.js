import { registerRootComponent } from "expo";
import { createElement } from "react";

const App = () => createElement("div", null, "Hello");

registerRootComponent(App);
