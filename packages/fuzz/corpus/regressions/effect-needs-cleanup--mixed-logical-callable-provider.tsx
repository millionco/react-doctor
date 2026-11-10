// rule: effect-needs-cleanup
// verdict: fail
// weakness: cleanup-guard
// source: independently-synthetic
import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
interface Subscription {
  remove: () => void;
}
interface OpaqueProvider {
  addListener: (event: string, callback: () => void) => Subscription;
}
export const MixedProviderPanel = ({ opaque }: { opaque: OpaqueProvider | null }) => {
  const navigation = useNavigation();
  useEffect(() => {
    const target = opaque || navigation;
    const subscription = target.addListener("event", () => {});
    return () => subscription();
  }, [opaque, navigation]);
  return null;
};
