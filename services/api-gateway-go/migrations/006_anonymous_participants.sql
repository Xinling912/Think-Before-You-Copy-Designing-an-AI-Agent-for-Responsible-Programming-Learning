create table if not exists participants (
  id text primary key,
  token_hash text not null unique,
  mode text not null,
  consented_at text not null default '',
  created_at text not null,
  last_seen_at text not null
);

create table if not exists participant_sessions (
  participant_id text not null,
  session_id text not null unique,
  created_at text not null,
  primary key (participant_id, session_id),
  foreign key (participant_id) references participants(id),
  foreign key (session_id) references sessions(id)
);

create index if not exists idx_participant_sessions_participant
  on participant_sessions (participant_id, created_at desc);
