create table if not exists evidence_events (
  id integer primary key autoincrement,
  session_id text not null,
  student_message_id integer,
  agent_message_id integer,
  event_type text not null,
  payload_json text not null,
  created_at text not null
);

create table if not exists learner_memory_v2 (
  id integer primary key autoincrement,
  memory_id text not null unique,
  learner_id text not null,
  memory_type text not null,
  topic text not null,
  content text not null,
  concepts_json text not null default '[]',
  source_event_id integer,
  source_session_id text,
  operation_origin text,
  strength integer not null default 1,
  use_count integer not null default 0,
  effective_score real not null default 0,
  status text not null default 'active',
  valid_from text not null,
  valid_to text,
  last_used_at text,
  updated_at text not null,
  payload_json text not null default '{}'
);

create table if not exists memory_events (
  id integer primary key autoincrement,
  learner_id text not null,
  session_id text not null,
  message_id integer,
  operation text not null,
  target_memory_id text,
  candidate_json text not null default '{}',
  result_memory_id text,
  reason text not null,
  created_at text not null
);

create table if not exists topic_summaries (
  id integer primary key autoincrement,
  learner_id text not null,
  topic text not null,
  summary text not null,
  mastered_concepts_json text not null default '[]',
  weak_concepts_json text not null default '[]',
  next_teaching_action text,
  source_session_id text,
  source_memory_ids_json text not null default '[]',
  updated_at text not null,
  unique (learner_id, topic)
);

create table if not exists learning_episodes (
  id integer primary key autoincrement,
  learner_id text not null,
  session_id text,
  student_message_id integer,
  agent_message_id integer,
  topic text,
  skill_state text,
  created_at text not null,
  payload_json text not null default '{}'
);

create table if not exists learning_entities (
  id integer primary key autoincrement,
  entity_id text not null unique,
  learner_id text not null,
  entity_type text not null,
  label text not null,
  first_seen_episode_id integer,
  last_seen_episode_id integer,
  confidence real not null default 1,
  status text not null default 'active',
  created_at text not null,
  updated_at text not null,
  payload_json text not null default '{}'
);

create table if not exists learning_facts (
  id integer primary key autoincrement,
  fact_id text not null unique,
  learner_id text not null,
  subject text not null,
  predicate text not null,
  object text not null,
  confidence real not null default 0,
  source_episode_id integer not null,
  valid_from text not null,
  valid_to text,
  status text not null default 'active',
  payload_json text not null default '{}'
);

create index if not exists idx_learning_entities_learner_type_status
  on learning_entities (learner_id, entity_type, status);

create index if not exists idx_learning_facts_temporal
  on learning_facts (learner_id, subject, predicate, object, status);

create table if not exists learner_profile (
  learner_id text primary key,
  profile_json text not null default '{}',
  updated_at text not null
);

create table if not exists kg_candidates (
  id integer primary key autoincrement,
  candidate_id text not null unique,
  source_chunk_id text not null,
  source_url text not null,
  subject text not null,
  predicate text not null,
  object text not null,
  confidence real not null default 0,
  evidence_text text not null,
  status text not null default 'pending',
  created_at text not null
);
