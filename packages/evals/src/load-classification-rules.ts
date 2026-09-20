import { createHash } from "node:crypto";

import { z } from "zod";

import { ruleContractSchema } from "./classification-schema.js";
import type { RuleContract } from "./classification-schema.js";
import { CLASSIFICATION_TIMEOUT_MS } from "./constants.js";
import { parseReactDoctorEvaluationProvenance } from "./utils/parse-react-doctor-evaluation-provenance.js";
import { pinnedRuleContracts } from "./pinned-rule-contracts.js";
import { loadPinnedClassificationSource } from "./prepare-classification.js";

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
      isProjectRule: z.boolean().optional(),
      defaultEnabled: z.boolean().optional(),
      minimumInkVersion: z.string().optional(),
      lifecycle: z.string().optional(),
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
      .filter(
        (entry) =>
          !entry.rule.isScanRule &&
          !entry.rule.isProjectRule &&
          (entry.rule.title || entry.rule.recommendation),
      )
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
          defaultEnabled: entry.rule.defaultEnabled ?? true,
          applicability: {
            framework: entry.rule.framework,
            requires: entry.rule.requires ?? [],
            disabledWhen: entry.rule.disabledWhen ?? [],
            tags: entry.rule.tags ?? [],
            minimumInkVersion: entry.rule.minimumInkVersion ?? null,
            lifecycle: entry.rule.lifecycle ?? "active",
          },
          contractSource: catalogUrl,
          contractHash: createHash("sha256").update(JSON.stringify(entry)).digest("hex"),
        }),
      );
    for (const contract of contracts) {
      const pinned = pinnedRuleContracts[contract.key];
      if (!pinned) continue;
      contract.requiredEvidence = pinned.contract.requiredEvidence;
      try {
        const [org, name] = repository.slice(1).split("/");
        const source = await loadPinnedClassificationSource(
          { org, name, rootDir: ".", ref: provenance.reactDoctorCommit },
          pinned.path,
        );
        const hash = createHash("sha256").update(source).digest("hex");
        if (hash !== pinned.sha256)
          throw new Error("Canonical rule source is not a supported revision");
        Object.assign(contract, pinned.contract, {
          contractSource: `https://raw.githubusercontent.com${repository}/${provenance.reactDoctorCommit}/${pinned.path}`,
          contractHash: hash,
        });
      } catch {
        contract.contractIssue =
          "Canonical exceptions/settings could not be verified at the detector revision; supply --rules";
      }
    }
    catalogCache.set(catalogUrl, contracts);
  }
  const enabledRuleKeys = new Set(provenance.ruleKeys);
  return enabledRuleKeys.size === 0
    ? contracts
    : contracts.filter((rule) => enabledRuleKeys.has(rule.key));
};
