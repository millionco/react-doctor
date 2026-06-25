import { App } from "App";
import { runAction } from "Actions/run-action";
import { helper } from "Utils/helper";

export const result = `${App}:${runAction()}:${helper()}`;
