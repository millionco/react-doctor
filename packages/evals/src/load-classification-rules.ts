import { z } from "zod";

import { ruleContractSchema } from "./classification-schema.js";
import type { RuleContract } from "./classification-schema.js";
import { CLASSIFICATION_TIMEOUT_MS } from "./constants.js";
import { parseReactDoctorEvaluationProvenance } from "./utils/parse-react-doctor-evaluation-provenance.js";

const catalogSchema = z.array(
  z.object({
    key: z.string(),
    rule: z.object({
      title: z.string().optional(),
      recommendation: z.string().optional(),
      framework: z.string(),
      requires: z.array(z.string()).optional(),
      disabledWhen: z.array(z.string()).optional(),
      tags: z.array(z.string()).optional(),
      isScanRule: z.boolean(),
    }),
  }),
);

export const loadClassificationRules = async (
  record: unknown,
  catalogCache: Map<string, RuleContract[]>,
): Promise<RuleContract[]> => {
  const { evaluation } = z.object({ evaluation: z.unknown() }).parse(record);
  const provenance = parseReactDoctorEvaluationProvenance(JSON.stringify(evaluation));
  const repositoryUrl = new URL(provenance.reactDoctorRepository);
  if (
    repositoryUrl.protocol !== "https:" ||
    repositoryUrl.hostname !== "github.com" ||
    !/^\/[\w.-]+\/[\w.-]+(?:\.git)?\/?$/.test(repositoryUrl.pathname)
  ) {
    throw new Error(
      "Automatic rule descriptions require a GitHub detector repository; use --rules",
    );
  }
  const repository = repositoryUrl.pathname.replace(/\/$/, "").replace(/\.git$/, "");
  const catalogUrl =
    `https://raw.githubusercontent.com${repository}/${provenance.reactDoctorCommit}/` +
    "packages/oxlint-plugin-react-doctor/src/plugin/core-rule-registry-data.json";
  let contracts = catalogCache.get(catalogUrl);
  if (!contracts) {
    const response = await fetch(catalogUrl, {
      signal: AbortSignal.timeout(CLASSIFICATION_TIMEOUT_MS),
    });
    if (!response.ok)
      throw new Error(`Rule catalog fetch failed (${response.status}); use --rules`);
    const catalog = catalogSchema.parse(await response.json());
    contracts = catalog
      .filter((entry) => !entry.rule.isScanRule && (entry.rule.title || entry.rule.recommendation))
      .map((entry) =>
        ruleContractSchema.parse({
          key: entry.key,
          description: [
            entry.rule.title,
            entry.rule.recommendation,
            `Applicability: ${JSON.stringify({
              framework: entry.rule.framework,
              requires: entry.rule.requires ?? [],
              disabledWhen: entry.rule.disabledWhen ?? [],
              tags: entry.rule.tags ?? [],
            })}`,
          ]
            .filter(Boolean)
            .join("\n"),
          exceptions: [
            "Honor the rule's framework and capability gates, including version requirements.",
            "If the description does not resolve a possible intentional exception, request review.",
          ],
          sampleSilentFiles: !entry.rule.isScanRule,
        }),
      );
    catalogCache.set(catalogUrl, contracts);
  }
  const enabledRuleKeys = new Set(provenance.ruleKeys);
  return enabledRuleKeys.size === 0
    ? contracts
    : contracts.filter((rule) => enabledRuleKeys.has(rule.key));
};
