import { fileURLToPath } from "node:url";
import { createGenerator, type Config } from "ts-json-schema-generator";
import * as fs from "node:fs";
import * as path from "node:path";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const SOURCE_TYPE_FILE = path.resolve(REPOSITORY_ROOT, "packages/core/src/types/config.ts");
const SOURCE_TSCONFIG = path.resolve(REPOSITORY_ROOT, "packages/core/tsconfig.json");
const OUTPUT_FILE = path.resolve(REPOSITORY_ROOT, "packages/website/public/schema/config.json");

const SCHEMA_ID = "https://react.doctor/schema/config.json";
const SCHEMA_TITLE = "React Doctor configuration";
const SCHEMA_DESCRIPTION =
  "Schema for doctor.config.* and the reactDoctor key inside package.json.";

const generatorConfig: Config = {
  path: SOURCE_TYPE_FILE,
  tsconfig: SOURCE_TSCONFIG,
  type: "ReactDoctorConfig",
  jsDoc: "extended",
  expose: "export",
  topRef: true,
  skipTypeCheck: true,
};

const generator = createGenerator(generatorConfig);
const schema = generator.createSchema(generatorConfig.type);

const {
  $schema: emittedSchemaDialect,
  $id: _emittedId,
  title: _emittedTitle,
  description: _emittedDescription,
  ...rest
} = schema as Record<string, unknown>;

const annotated = {
  $schema: emittedSchemaDialect,
  $id: SCHEMA_ID,
  title: SCHEMA_TITLE,
  description: SCHEMA_DESCRIPTION,
  ...rest,
};

fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(annotated, undefined, 2)}\n`, "utf8");

console.log(`Wrote ${OUTPUT_FILE}`);
