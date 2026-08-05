import { parseJSON5 } from "confbox";
import * as fs from "node:fs";

export const readJson5File = (filePath: string): unknown =>
  parseJSON5(fs.readFileSync(filePath, "utf-8"));
