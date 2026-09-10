import { useMutation } from '@tanstack/react-query';
import { Button, Text, View } from 'react-native';
import { create } from 'zustand';

declare function purchase(): Promise<'purchased' | 'cancelled'>;
declare function getMembership(): Promise<{ tier: string }>;
const useMembership = create<{ tier: string }>(() => ({ tier: 'free' }));

async function reconcileMembership() {
  const membership = await getMembership();
  useMembership.setState(membership);
}

export function Upgrade() {
  const tier = useMembership((state) => state.tier);
  const upgrade = useMutation({
    mutationFn: async () => {
      if ((await purchase()) === 'purchased') await reconcileMembership();
    },
  });
  return (
    <View>
      <Text>{tier}</Text>
      <Button title="Upgrade" disabled={upgrade.isPending} onPress={() => upgrade.mutate()} />
    </View>
  );
}
