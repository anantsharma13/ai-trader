create table portfolio (
  id serial primary key,
  cash numeric not null,
  starting_capital numeric not null,
  created_at timestamptz default now()
);

create table positions (
  id serial primary key,
  symbol text not null,
  qty integer not null,
  avg_price numeric not null,
  opened_at date not null,
  status text default 'open'
);

create table orders (
  id serial primary key,
  run_date date not null,
  symbol text not null,
  side text not null,
  qty integer not null,
  fill_price numeric,
  rationale text,
  confidence numeric,
  signals jsonb,
  created_at timestamptz default now()
);

create table candidates (
  id serial primary key,
  run_date date not null,
  symbol text not null,
  consensus text,
  target_price numeric,
  source_count integer,
  macro_flags jsonb,
  selected boolean default false
);

create table daily_pnl (
  id serial primary key,
  run_date date not null unique,
  portfolio_value numeric,
  cash numeric,
  realized_pnl numeric,
  unrealized_pnl numeric,
  day_return_pct numeric,
  cum_return_pct numeric
);
