import { z } from "zod";
import type { RuleContract } from "../classification-schema.js";
import { CLASSIFICATION_CAPABILITY_FIELDS, CLASSIFICATION_REACT_FRAMEWORKS } from "../constants.js";

export interface ClassificationApplicability {
  status: "applicable" | "inapplicable" | "unknown";
  reasons: string[];
}

export interface ClassificationApplicabilityInput {
  rule: RuleContract;
  framework: string;
  project: Record<string, unknown>;
}

const applicabilitySchema = z.object({
  framework: z.string().optional(),
  minimumInkVersion: z.string().nullish(),
  requires: z.array(z.string()).optional(),
  disabledWhen: z.array(z.string()).optional(),
});

export const getClassificationApplicability = ({
  rule,
  framework,
  project,
}: ClassificationApplicabilityInput): ClassificationApplicability => {
  const parsed = applicabilitySchema.safeParse(rule.applicability ?? {});
  if (!parsed.success)
    return { status: "unknown", reasons: ["Unsupported applicability metadata"] };
  const capabilityStatus = (capability: string): boolean | undefined => {
    const base = capability.split(":")[0];
    if (base === framework) return capability === base ? true : undefined;
    if (base === "react" && CLASSIFICATION_REACT_FRAMEWORKS.has(framework))
      return capability === base ? true : undefined;
    if (base === "react-native" && (framework === "react-native" || framework === "expo"))
      return capability === base ? true : undefined;
    const fields =
      CLASSIFICATION_CAPABILITY_FIELDS[capability] ?? CLASSIFICATION_CAPABILITY_FIELDS[base];
    if (!fields) return undefined;
    const values = fields.map((field) => project[field]);
    const present = values.some(
      (value) => value === true || (typeof value === "string" && value.length > 0),
    );
    if (present)
      return capability === base || CLASSIFICATION_CAPABILITY_FIELDS[capability] ? true : undefined;
    return values.every((value) => value === false || value === null) ? false : undefined;
  };
  const requirements =
    parsed.data.requires ??
    (parsed.data.framework && parsed.data.framework !== "global" ? [parsed.data.framework] : []);
  const excluded: string[] = [];
  const unknown: string[] = [];
  if (parsed.data.minimumInkVersion) unknown.push("Minimum Ink version unresolved");
  for (const capability of requirements) {
    const status = capabilityStatus(capability);
    if (status === false) excluded.push(`Required capability absent: ${capability}`);
    if (status === undefined) unknown.push(`Required capability unresolved: ${capability}`);
  }
  for (const capability of parsed.data.disabledWhen ?? []) {
    const status = capabilityStatus(capability);
    if (status === true) excluded.push(`Disabling capability present: ${capability}`);
    if (status === undefined) unknown.push(`Disabling capability unresolved: ${capability}`);
  }
  if (excluded.length > 0) return { status: "inapplicable", reasons: excluded };
  return { status: unknown.length > 0 ? "unknown" : "applicable", reasons: unknown };
};
