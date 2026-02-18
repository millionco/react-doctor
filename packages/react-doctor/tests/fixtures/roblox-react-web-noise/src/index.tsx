import React, { useEffect, useState } from "@rbxts/react";

interface UserCardProps {
  displayName: string;
}

const UserCard = ({ displayName }: UserCardProps) => {
  const [derivedDisplayName] = useState(displayName);

  useEffect(() => {
    fetch("https://example.com/profile");
  }, []);

  return (
    <frame BackgroundTransparency={1}>
      <textlabel Text={derivedDisplayName} />
      <textbutton
        Text="Activate"
        Event={{
          Activated: () => print("activated"),
        }}
      />
    </frame>
  );
};

export default UserCard;
