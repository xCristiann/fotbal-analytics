-- Schema initiala pentru platforma de analiza meciuri.
-- Ruleaza acest script in Supabase: Project -> SQL Editor -> New query -> Run

create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  api_football_id integer unique not null,
  name text not null,
  league_id integer not null,
  created_at timestamptz default now()
);

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  api_football_id integer unique not null,
  league_id integer not null,
  home_team_name text not null,
  away_team_name text not null,
  kickoff_utc timestamptz not null,
  status text,
  created_at timestamptz default now()
);

create table if not exists predictions (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  market text not null,
  selection text not null,
  label text not null,
  probability numeric not null,
  fair_odds numeric not null,
  created_at timestamptz default now()
);

create table if not exists odds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  bookmaker text not null,
  market text not null,
  selection text not null,
  odd_value numeric not null,
  fetched_at timestamptz default now()
);

create index if not exists idx_matches_kickoff on matches(kickoff_utc);
create index if not exists idx_predictions_match on predictions(match_id);
create index if not exists idx_odds_match on odds(match_id);

-- Row Level Security: citire publica, scrierea se face doar din server
-- (cu service role key, care ocoleste automat RLS)
alter table matches enable row level security;
alter table predictions enable row level security;
alter table odds enable row level security;
alter table teams enable row level security;

create policy "Citire publica meciuri" on matches for select using (true);
create policy "Citire publica predictii" on predictions for select using (true);
create policy "Citire publica cote" on odds for select using (true);
create policy "Citire publica echipe" on teams for select using (true);
