import * as Schema from "effect/Schema";

export class DiagnosticContextRangeSchema extends Schema.Class<DiagnosticContextRangeSchema>(
  "DiagnosticContextRange",
)({
  offset: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  length: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
}) {}
