import type { ReactDoctorConfig } from "../types/index.js";

/**
 * Identity helper for authoring a typed `doctor.config.{ts,js,mjs,cjs}`.
 * Gives editor autocomplete and type-checking for the config object without
 * an explicit `satisfies ReactDoctorConfig` annotation; returns the config
 * untouched so the loader sees the same plain object either way.
 */
export const defineConfig = (config: ReactDoctorConfig): ReactDoctorConfig => config;
