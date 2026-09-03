import { REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV } from "../../constants.js";

export const isNativeOxlintRequired = (): boolean =>
  process.env[REACT_DOCTOR_NATIVE_OXLINT_REQUIRED_ENV] === "1";
