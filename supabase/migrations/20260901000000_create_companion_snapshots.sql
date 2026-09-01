-- Un snapshot JSONB par utilisateur. Le format JSON suit schemaVersion dans
-- src/storage.ts et ne contient aucune donnee GitHub ni aucun code de solution.
create table if not exists public.companion_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null check (schema_version >= 2),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  client_updated_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.companion_snapshots enable row level security;

revoke all on table public.companion_snapshots from anon, authenticated;
grant select, insert, update on table public.companion_snapshots to authenticated;

drop policy if exists "companion_snapshots_select_own" on public.companion_snapshots;
create policy "companion_snapshots_select_own"
on public.companion_snapshots
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "companion_snapshots_insert_own" on public.companion_snapshots;
create policy "companion_snapshots_insert_own"
on public.companion_snapshots
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "companion_snapshots_update_own" on public.companion_snapshots;
create policy "companion_snapshots_update_own"
on public.companion_snapshots
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
