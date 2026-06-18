// Dead root that imports one dead child and one child that is also reachable elsewhere.
import { helper } from "./helpers";
import { sharedValue } from "../shared/utils";

console.log(helper(), sharedValue());

export const setup = (): string => "setup";
