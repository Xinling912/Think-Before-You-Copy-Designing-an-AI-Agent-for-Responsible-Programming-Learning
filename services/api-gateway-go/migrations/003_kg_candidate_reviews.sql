create table if not exists kg_candidate_reviews (
  id integer primary key autoincrement,
  candidate_id text not null unique,
  status text not null check (status in ('approved', 'rejected')),
  reviewer_id text not null,
  reviewer_note text not null default '',
  reviewed_at text not null,
  created_at text not null,
  updated_at text not null
);

create index if not exists idx_kg_candidate_reviews_status_reviewed_at
  on kg_candidate_reviews (status, reviewed_at);
