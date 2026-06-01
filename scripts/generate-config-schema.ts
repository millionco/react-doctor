import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createGenerator, type Config } from "ts-json-schema-generator";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const SOURCE_TYPE_FILE = resolve(REPOSITORY_ROOT, "packages/core/src/types/config.ts");
const SOURCE_TSCONFIG = resolve(REPOSITORY_ROOT, "packages/core/tsconfig.json");
const OUTPUT_FILE = resolve(REPOSITORY_ROOT, "packages/website/public/schema/config.json");

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

mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
writeFileSync(OUTPUT_FILE, `${JSON.stringify(annotated, undefined, 2)}\n`, "utf8");

console.log(`Wrote ${OUTPUT_FILE}`);
