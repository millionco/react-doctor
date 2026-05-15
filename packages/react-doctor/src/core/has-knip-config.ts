import path from "node:path";
import { KNIP_CONFIG_LOCATIONS } from "../constants.js";
import { isFile } from "./is-file.js";

export const hasKnipConfig = (directory: string): boolean =>
  KNIP_CONFIG_LOCATIONS.some((configFilename) => isFile(path.join(directory, configFilename)));
