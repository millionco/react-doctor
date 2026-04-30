import ora from "ora";

let sharedInstance: ReturnType<typeof ora> | null = null;
let activeCount = 0;
const pendingTexts = new Set<string>();
const finalizedHandles = new WeakSet<object>();

let isSilent = false;

export const setSpinnerSilent = (silent: boolean): void => {
  isSilent = silent;
};

export const isSpinnerSilent = (): boolean => isSilent;

const noopHandle = Object.freeze({
  succeed: () => {},
  fail: () => {},
});

const finalize = (method: "succeed" | "fail", originalText: string, displayText: string) => {
  pendingTexts.delete(originalText);
  activeCount = Math.max(0, activeCount - 1);

  if (activeCount === 0 || !sharedInstance) {
    sharedInstance?.[method](displayText);
    sharedInstance = null;
    activeCount = 0;
    return;
  }

  sharedInstance.stop();
  ora(displayText).start()[method](displayText);

  const [remainingText] = pendingTexts;
  if (remainingText) {
    sharedInstance.text = remainingText;
  }
  sharedInstance.start();
};

export const spinner = (text: string) => ({
  start() {
    if (isSilent) return noopHandle;

    activeCount++;
    pendingTexts.add(text);

    if (!sharedInstance) {
      sharedInstance = ora({ text }).start();
    } else {
      sharedInstance.text = text;
    }

    const handle = {
      succeed: (displayText: string) => {
        if (finalizedHandles.has(handle)) return;
        finalizedHandles.add(handle);
        finalize("succeed", text, displayText);
      },
      fail: (displayText: string) => {
        if (finalizedHandles.has(handle)) return;
        finalizedHandles.add(handle);
        finalize("fail", text, displayText);
      },
    };
    return handle;
  },
});
