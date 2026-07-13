import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_KEY,
);

export const loadMessages = () =>
  supabase.from("messages").select().range(0, 49).order("id", { ascending: false });

export const sendMessage = (text, username, country) =>
  supabase.from("messages").insert([{ text, username, country, is_authenticated: false }]);
