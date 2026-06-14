create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  room_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index messages_room_id_idx on public.messages (room_id);
