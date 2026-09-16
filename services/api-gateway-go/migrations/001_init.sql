create table if not exists sessions (
  id text primary key,
  created_at text not null,
  scenario text not null,
  status text not null
);

create table if not exists messages (
  id integer primary key autoincrement,
  session_id text not null,
  role text not null,
  content text not null,
  created_at text not null,
  foreign key (session_id) references sessions(id)
);

create table if not exists evidence_events (
  id integer primary key autoincrement,
  session_id text not null,
  event_type text not null,
  payload_json text not null,
  created_at text not null,
  foreign key (session_id) references sessions(id)
);

create table if not exists skill_usage (
  id integer primary key autoincrement,
  session_id text not null,
  skill_id text not null,
  hint_level integer,
  direct_answer_given integer not null default 0,
  created_at text not null,
  foreign key (session_id) references sessions(id)
);

create table if not exists learner_memory (
  id integer primary key autoincrement,
  learner_id text not null,
  memory_type text not null,
  payload_json text not null,
  updated_at text not null
);
