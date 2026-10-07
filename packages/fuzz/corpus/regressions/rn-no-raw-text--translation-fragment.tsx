// rule: rn-no-raw-text
// verdict: pass
// weakness: wrapper-transparency
// source: issue #1731

import { Text } from "react-native";

interface ReminderLabelProps {
  reminder: "none" | "morning";
}

export const ReminderLabel = ({ reminder }: ReminderLabelProps) => {
  switch (reminder) {
    case "none":
      return <fbt desc="no reminder">No reminder</fbt>;
    case "morning":
      return (
        <>
          <fbt desc="morning reminder">Morning</fbt>, 7:00 AM
        </>
      );
  }
};

export const Screen = () => (
  <Text>
    <ReminderLabel reminder="morning" />
  </Text>
);
