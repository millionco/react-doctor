// rule: no-set-state-after-await-in-effect
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (referral launcher: the dep only gates whether to fetch; the awaited work reads no per-render value)
import { useEffect, useState } from "react";
import referralService from "./referral-service";
import { useAppSelector } from "./store";

export const NavbarGlobalSearch = () => {
  const isReferralEligible = useAppSelector((state) => state.referrals.isEligible);
  const [customLauncherLabel, setCustomLauncherLabel] = useState("");
  useEffect(() => {
    const fetchLabel = async () => {
      const label = await referralService.getCustomLauncherLabel();
      if (label) {
        setCustomLauncherLabel(label);
      }
    };
    if (isReferralEligible) {
      void fetchLabel();
    }
  }, [isReferralEligible]);
  return <span>{customLauncherLabel}</span>;
};
