import {
  MATRIX_BASE_LANE_ID,
  MATRIX_CPU_CORES_PER_LANE,
  MATRIX_DISK_GIB_PER_DETECTOR,
  MATRIX_MEMORY_GIB_PER_LANE,
  MATRIX_PROVENANCE_DIRECTORY,
  MATRIX_REACT_DOCTOR_DIRECTORY,
  MATRIX_REPORT_DIRECTORY,
  MATRIX_TARGET_WORKTREE_DIRECTORY,
} from "./constants.js";
import type {
  LoadedMatrixTreatment,
  MatrixEvaluationGroup,
} from "./matrix-treatment-descriptor.js";

export interface MatrixEvaluationLane {
  id: string;
  kind: "base" | "treatment";
  reactDoctorRepository: string;
  reactDoctorRef: string;
  ruleKeys: ReadonlyArray<string>;
  reactDoctorWorkDirectory: string;
  provenancePath: string;
  targetWorkDirectory: string;
  reportPath: string;
  treatment?: LoadedMatrixTreatment;
}

export interface MatrixEvaluationPlan {
  group: MatrixEvaluationGroup;
  lanes: ReadonlyArray<MatrixEvaluationLane>;
  treatments: ReadonlyArray<LoadedMatrixTreatment>;
  waveWidth: number;
  resources: {
    cpu: number;
    memory: number;
    disk: number;
  };
  hasVerifiedFullBaseline: boolean;
}

const buildLanePaths = (id: string) => ({
  reactDoctorWorkDirectory: `${MATRIX_REACT_DOCTOR_DIRECTORY}/${id}`,
  provenancePath: `${MATRIX_PROVENANCE_DIRECTORY}/${id}.json`,
  targetWorkDirectory: `${MATRIX_TARGET_WORKTREE_DIRECTORY}/${id}`,
  reportPath: `${MATRIX_REPORT_DIRECTORY}/${id}.json`,
});

export const buildMatrixEvaluationPlan = ({
  treatments,
  waveWidth,
  hasVerifiedFullBaseline,
}: {
  treatments: ReadonlyArray<LoadedMatrixTreatment>;
  waveWidth: number;
  hasVerifiedFullBaseline: boolean;
}): MatrixEvaluationPlan => {
  const firstTreatment = treatments[0];
  if (!firstTreatment) throw new Error("Matrix evaluation requires at least one treatment");
  const treatmentLanes = treatments.map(
    (treatment): MatrixEvaluationLane => ({
      id: treatment.descriptor.id,
      kind: "treatment",
      reactDoctorRepository: treatment.descriptor.reactDoctorRepository,
      reactDoctorRef: treatment.descriptor.reactDoctorCommit,
      ruleKeys: treatment.ruleKeys,
      ...buildLanePaths(treatment.descriptor.id),
      treatment,
    }),
  );
  const hasFullTreatment = treatments.some((treatment) => treatment.impactManifest.mode === "full");
  const baseRuleKeys = hasFullTreatment
    ? []
    : [
        ...new Set(treatments.flatMap((treatment) => treatment.impactManifest.candidateRuleKeys)),
      ].sort();
  const baseLane: MatrixEvaluationLane = {
    id: MATRIX_BASE_LANE_ID,
    kind: "base",
    reactDoctorRepository: firstTreatment.descriptor.group.baseReactDoctorRepository,
    reactDoctorRef: firstTreatment.descriptor.group.baseReactDoctorCommit,
    ruleKeys: baseRuleKeys,
    ...buildLanePaths(MATRIX_BASE_LANE_ID),
  };
  const lanes = hasVerifiedFullBaseline ? treatmentLanes : [...treatmentLanes, baseLane];
  return {
    group: firstTreatment.descriptor.group,
    lanes,
    treatments,
    waveWidth,
    resources: {
      cpu: waveWidth * MATRIX_CPU_CORES_PER_LANE,
      memory: waveWidth * MATRIX_MEMORY_GIB_PER_LANE,
      disk: lanes.length * MATRIX_DISK_GIB_PER_DETECTOR,
    },
    hasVerifiedFullBaseline,
  };
};
