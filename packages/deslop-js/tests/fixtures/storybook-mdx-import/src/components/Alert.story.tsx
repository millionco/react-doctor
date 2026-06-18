import mdx from "./Alert.mdx";
import { Alert } from "./Alert";

export default {
  title: "Components/Alert",
  component: Alert,
  parameters: {
    docs: {
      page: mdx,
    },
  },
};

export const Default = () => Alert();
