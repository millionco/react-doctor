export const renderProfile = (profile: { id: string; name: string; email: string }): string =>
  `${profile.id}:${profile.name}:${profile.email}`;
