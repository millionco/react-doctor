// Presence-based env vars that signal an active ML training pipeline, data
// collection job, RL simulation, or AI-agent sandbox. Auth/config vars (e.g.
// OPENAI_API_KEY, HF_TOKEN) are excluded — a stored credential doesn't mean
// the process is inside a training run. Active-run or hardware-binding vars do.
const AI_TRAINING_ENV_VARS: ReadonlyArray<readonly [string, string]> = [
  // HuggingFace – dataset/cache paths only (active data pipeline, not just auth)
  ["HF_DATASETS_CACHE", "huggingface"],
  ["HF_HOME", "huggingface"],
  ["HUGGINGFACE_HUB_CACHE", "huggingface"],
  // GPU compute – hardware binding means an active training or inference job
  ["CUDA_VISIBLE_DEVICES", "cuda"],
  ["NVIDIA_VISIBLE_DEVICES", "nvidia"],
  // Experiment tracking – active run IDs, not just stored API keys
  ["WANDB_RUN_ID", "wandb"],
  ["MLFLOW_RUN_ID", "mlflow"],
  ["MLFLOW_TRACKING_URI", "mlflow"],
  ["COMET_EXPERIMENT_KEY", "comet"],
  ["NEPTUNE_RUN_ID", "neptune"],
  // Ray – distributed ML/RL workers
  ["RAY_WORKER_PROCESS", "ray"],
  ["RAY_ADDRESS", "ray"],
  // RL simulation environments
  ["MUJOCO_GL", "mujoco"],
  ["MUJOCO_PATH", "mujoco"],
  ["GYM_DISABLE_ENV_CHECKER", "gymnasium"],
  // Cloud ML platforms – job/model dir presence implies a managed training job
  ["SAGEMAKER_BASE_DIR", "sagemaker"],
  ["AZURE_ML_MODEL_DIR", "azure-ml"],
  ["VERTEX_AI_LOG_LEVEL", "vertex-ai"],
  // Sandboxed code-execution environments used by AI agents
  ["DAYTONA_WS_ID", "daytona"],
  ["DAYTONA_WS_NAME", "daytona"],
  ["E2B_SANDBOX_ID", "e2b"],
  ["MODAL_FUNCTION_ID", "modal"],
  ["MODAL_TASK_ID", "modal"],
  ["RUNPOD_POD_ID", "runpod"],
  // Container registries for ML artifacts
  ["HARBOR_URL", "harbor"],
  ["HARBOR_HOSTNAME", "harbor"],
  // Coding-agent evaluation harnesses (SWE-bench and derivatives)
  ["SWE_BENCH_TASK", "swe-bench"],
  ["SWEBENCH_TASK", "swe-bench"],
  ["SWE_AGENT_MODEL", "swe-agent"],
  // Notebook environments – active session markers
  ["KAGGLE_KERNEL_RUN_TYPE", "kaggle"],
  ["COLAB_BACKEND_VERSION", "google-colab"],
  ["DATABRICKS_RUNTIME_VERSION", "databricks"],
  // ML training platforms – active job or run identifiers
  ["SM_TRAINING_ENV", "sagemaker"],
  ["TRAINING_JOB_ARN", "sagemaker"],
  ["AZUREML_RUN_ID", "azure-ml"],
  ["CLOUD_ML_PROJECT_ID", "vertex-ai"],
  ["WANDB_SWEEP_ID", "wandb"],
  ["DVC_STAGE", "dvc"],
  ["CLEARML_TASK_ID", "clearml"],
  ["FLYTE_INTERNAL_EXECUTION_ID", "flyte"],
  ["DET_MASTER", "determined-ai"],
  ["LIGHTNING_USER_ID", "lightning-ai"],
  ["ARGO_WORKFLOW_NAME", "argo-workflows"],
  ["KFP_POD_NAME", "kubeflow-pipelines"],
  // GPU cloud platforms
  ["SPACE_ID", "huggingface-spaces"],
  ["REPLICATE_USERNAME", "replicate"],
  ["VAST_CONTAINERLABEL", "vast-ai"],
  ["TPU_NAME", "google-tpu"],
  ["ROCR_VISIBLE_DEVICES", "rocm"],
] as const;

export const detectAiTrainingEnvironment = (): string | null => {
  for (const [envVar, label] of AI_TRAINING_ENV_VARS) {
    if (process.env[envVar] !== undefined) return label;
  }
  return null;
};

export const isAiTrainingEnvironment = (): boolean => detectAiTrainingEnvironment() !== null;
