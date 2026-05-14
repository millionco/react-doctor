import { SETTER_PATTERN } from "../constants/react.js";

export const isSetterIdentifier = (name: string): boolean => SETTER_PATTERN.test(name);
