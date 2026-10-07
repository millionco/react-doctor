import { FLASH_LIST_V2_MAJOR } from "../../../constants/react-native.js";
import { getReactDoctorNumberSetting } from "../../../utils/get-react-doctor-setting.js";
import type { RuleContext } from "../../../utils/rule-context.js";

export const isFlashListV2OrNewer = (context: RuleContext): boolean => {
  const flashListMajorVersion = getReactDoctorNumberSetting(
    context.settings,
    "shopifyFlashListMajorVersion",
  );
  return flashListMajorVersion !== undefined && flashListMajorVersion >= FLASH_LIST_V2_MAJOR;
};
