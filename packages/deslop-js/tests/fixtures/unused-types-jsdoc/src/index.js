import { renderShape } from "./jsdoc-consumer.js";
import { bridgeValue } from "./bridge.js";

console.log(renderShape({ marker: "jsdoc-consumed", count: 1 }), bridgeValue);
