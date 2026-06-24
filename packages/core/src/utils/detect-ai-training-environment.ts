// Presence-based env vars that signal an active ML training pipeline, data
// collection job, RL simulation, or AI-agent sandbox. Auth/config vars (e.g.
// OPENAI_API_KEY, HF_TOKEN) are excluded — a stored credential doesn't mean
// the process is inside a training run. Active-run or hardware-binding vars do.
// Shared by the CLI warning and the programmatic API so the list lives once.
const AI_TRAINING_ENV_VARS: ReadonlyArray<readonly [string, string]> = [
  // HuggingFace — dataset/cache paths only (active data pipeline, not just auth)
  ["HF_DATASETS_CACHE", "huggingface"],
  ["HF_HOME", "huggingface"],
  ["HUGGINGFACE_HUB_CACHE", "huggingface"],
  ["SPACE_ID", "huggingface-spaces"],
  // GPU/accelerator binding — implies an active training or inference job
  ["CUDA_VISIBLE_DEVICES", "cuda"],
  ["NVIDIA_VISIBLE_DEVICES", "nvidia"],
  ["ROCR_VISIBLE_DEVICES", "rocm"],
  ["TPU_NAME", "google-tpu"],
  // Experiment tracking — active run/sweep IDs, not just stored API keys
  ["WANDB_RUN_ID", "wandb"],
  ["WANDB_SWEEP_ID", "wandb"],
  ["MLFLOW_RUN_ID", "mlflow"],
  ["MLFLOW_TRACKING_URI", "mlflow"],
  ["COMET_EXPERIMENT_KEY", "comet"],
  ["NEPTUNE_RUN_ID", "neptune"],
  ["CLEARML_TASK_ID", "clearml"],
  ["DVC_STAGE", "dvc"],
  // Distributed ML/RL workers
  ["RAY_WORKER_PROCESS", "ray"],
  ["RAY_ADDRESS", "ray"],
  // RL simulation environments
  ["MUJOCO_GL", "mujoco"],
  ["MUJOCO_PATH", "mujoco"],
  ["GYM_DISABLE_ENV_CHECKER", "gymnasium"],
  // Managed cloud ML platforms — job/model dir or run IDs imply a training job
  ["SM_TRAINING_ENV", "sagemaker"],
  ["TRAINING_JOB_ARN", "sagemaker"],
  ["SAGEMAKER_BASE_DIR", "sagemaker"],
  ["AZUREML_RUN_ID", "azure-ml"],
  ["AZURE_ML_MODEL_DIR", "azure-ml"],
  ["CLOUD_ML_PROJECT_ID", "vertex-ai"],
  ["VERTEX_AI_LOG_LEVEL", "vertex-ai"],
  ["DET_MASTER", "determined-ai"],
  ["LIGHTNING_USER_ID", "lightning-ai"],
  // ML pipeline orchestrators
  ["FLYTE_INTERNAL_EXECUTION_ID", "flyte"],
  ["ARGO_WORKFLOW_NAME", "argo-workflows"],
  ["KFP_POD_NAME", "kubeflow-pipelines"],
  // Notebook environments — active session markers
  ["KAGGLE_KERNEL_RUN_TYPE", "kaggle"],
  ["COLAB_BACKEND_VERSION", "google-colab"],
  ["DATABRICKS_RUNTIME_VERSION", "databricks"],
  // GPU cloud / sandboxed code-execution platforms used by AI agents
  ["DAYTONA_WS_ID", "daytona"],
  ["DAYTONA_WS_NAME", "daytona"],
  ["E2B_SANDBOX_ID", "e2b"],
  ["MODAL_FUNCTION_ID", "modal"],
  ["MODAL_TASK_ID", "modal"],
  ["RUNPOD_POD_ID", "runpod"],
  ["REPLICATE_USERNAME", "replicate"],
  ["VAST_CONTAINERLABEL", "vast-ai"],
  // Container registries for ML artifacts
  ["HARBOR_URL", "harbor"],
  ["HARBOR_HOSTNAME", "harbor"],
  // Coding-agent evaluation harnesses (SWE-bench and derivatives)
  ["SWE_BENCH_TASK", "swe-bench"],
  ["SWEBENCH_TASK", "swe-bench"],
  ["SWE_AGENT_MODEL", "swe-agent"],
];

export const detectAiTrainingEnvironment = (): string | null => {
  for (const [envVar, label] of AI_TRAINING_ENV_VARS) {
    // Truthy, not just defined: an empty value (e.g. `CUDA_VISIBLE_DEVICES=""`,
    // which disables the GPU) shouldn't classify the run as a training pipeline.
    if (process.env[envVar]) return label;
  }
  return null;
};
