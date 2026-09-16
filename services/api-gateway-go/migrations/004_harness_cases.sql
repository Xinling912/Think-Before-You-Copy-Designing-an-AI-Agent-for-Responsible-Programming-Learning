create table if not exists harness_cases (
  id integer primary key autoincrement,
  case_id text not null unique,
  suite_id text not null,
  scenario_id text not null default '',
  status text not null check (status in ('pending', 'confirmed', 'deleted')),
  natural_language_request text not null,
  case_json text not null,
  validator_errors_json text not null default '[]',
  model text not null default '',
  llm_used integer not null default 0,
  llm_fallback integer not null default 0,
  created_at text not null,
  confirmed_at text,
  deleted_at text
);

create index if not exists idx_harness_cases_suite_status
  on harness_cases (suite_id, status, created_at);

create table if not exists harness_case_events (
  id integer primary key autoincrement,
  case_id text not null,
  event_type text not null check (event_type in ('compiled', 'confirmed', 'deleted')),
  payload_json text not null default '{}',
  created_at text not null
);

create index if not exists idx_harness_case_events_case
  on harness_case_events (case_id, created_at);
