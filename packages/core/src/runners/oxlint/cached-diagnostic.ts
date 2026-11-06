import { DiagnosticContextRangeSchema } from "../../utils/diagnostic-context-range-schema.js";
import * as Schema from "effect/Schema";
import { Diagnostic } from "../../schemas.js";

export class CachedDiagnostic extends Schema.Class<CachedDiagnostic>("CachedDiagnostic")({
  ...Diagnostic.fields,
  contextRanges: Schema.optional(Schema.Array(DiagnosticContextRangeSchema)),
}) {}
