import { describe, expect, it } from "vite-plus/test";
import { detectAiTrainingEnvironment } from "../src/utils/detect-ai-training-environment.js";

describe("detectAiTrainingEnvironment", () => {
  it("returns null without AI training signals", () => {
    expect(detectAiTrainingEnvironment({})).toBeNull();
  });

  it.each([
    ["WANDB_RUN_ID", "wandb"],
    ["SM_TRAINING_ENV", "sagemaker"],
    ["E2B_SANDBOX_ID", "e2b"],
    ["SWE_BENCH_TASK", "swe-bench"],
    ["COLAB_BACKEND_VERSION", "google-colab"],
  ])("returns %s's label", (environmentVariable, expectedLabel) => {
    expect(detectAiTrainingEnvironment({ [environmentVariable]: "active" })).toBe(expectedLabel);
  });

  it("ignores empty and whitespace-only values", () => {
    expect(detectAiTrainingEnvironment({ WANDB_RUN_ID: "" })).toBeNull();
    expect(detectAiTrainingEnvironment({ WANDB_RUN_ID: "   " })).toBeNull();
  });

  it("does not match credentials or broad development environment markers", () => {
    expect(
      detectAiTrainingEnvironment({
        AZURE_ML_MODEL_DIR: "/tmp/model",
        AZUREML_MODEL_DIR: "/var/azureml-app/azureml-models/example/1",
        CUDA_VISIBLE_DEVICES: "0",
        CURSOR_AGENT: "1",
        DET_MASTER: "https://determined.example",
        HF_HOME: "/tmp/huggingface",
        HF_TOKEN: "token",
        HARBOR_URL: "https://harbor.example",
        MLFLOW_TRACKING_URI: "https://mlflow.example",
        OPENAI_API_KEY: "token",
        REPLICATE_USERNAME: "user",
      }),
    ).toBeNull();
  });

  it("returns the first matching label", () => {
    expect(
      detectAiTrainingEnvironment({
        E2B_SANDBOX_ID: "sandbox",
        WANDB_RUN_ID: "run",
      }),
    ).toBe("wandb");
  });
});
