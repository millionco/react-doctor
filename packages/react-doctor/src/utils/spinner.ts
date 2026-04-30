import ora from "ora";

let sharedInstance: ReturnType<typeof ora> | null = null;
let activeCount = 0;
const pendingTexts = new Set<string>();

let isSilent = false;

export const setSpinnerSilent = (silent: boolean): void => {
  isSilent = silent;
};

const noopHandle = {
  succeed: () => {},
  fail: () => {},
};

const finalize = (method: "succeed" | "fail", originalText: string, displayText: string) => {
  pendingTexts.delete(originalText);
  activeCount--;

  if (activeCount <= 0 || !sharedInstance) {
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

    return {
      succeed: (displayText: string) => finalize("succeed", text, displayText),
      fail: (displayText: string) => finalize("fail", text, displayText),
    };
  },
});
