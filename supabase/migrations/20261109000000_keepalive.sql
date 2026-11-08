-- Tiny table used by the GitHub Actions keep-alive workflow.
-- Free-tier Supabase projects pause after 7 days without user database activity.
create table if not exists public.keepalive (
  id bigint generated always as identity primary key,
  pinged_at timestamptz not null default now()
);

alter table public.keepalive enable row level security;

drop policy if exists "keepalive anon read" on public.keepalive;
create policy "keepalive anon read"
  on public.keepalive
  for select
  to anon
  using (true);

grant select on table public.keepalive to anon;
