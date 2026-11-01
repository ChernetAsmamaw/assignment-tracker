-- Pace saves everything in this one table. In your Supabase project, open the SQL Editor,
-- paste all of this in and click Run. Running it again is safe.

create table if not exists public.pace (
  collection text not null,  -- what kind of item: lectures, progress, checkins, kv, ...
  id text not null,          -- the item's id in its collection
  value text not null,       -- the item, as JSON
  expires_at timestamptz,    -- when a cached AI answer runs out (empty for everything else)
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

-- Only Pace's server, with the secret key, can read or change it. The publishable key is
-- public by design, so it gets no access at all.
alter table public.pace enable row level security;
revoke all on table public.pace from anon, authenticated;
grant select, insert, update, delete on table public.pace to service_role;

-- Let the API see the new table right away.
notify pgrst, 'reload schema';
