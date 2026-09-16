create table if not exists learner_topic_progress (
    learner_id text not null,
    topic_id text not null,
    score integer not null default 0 check(score between 0 and 10),
    last_completed_level integer not null default 0 check(last_completed_level between 0 and 10),
    last_question_id text,
    last_attempt_id text,
    created_at text not null,
    updated_at text not null,
    primary key (learner_id, topic_id)
);

create table if not exists test_questions (
    id text primary key,
    learner_id text not null,
    topic_id text not null,
    level integer not null check(level between 1 and 10),
    question_format text not null default '',
    question_text text not null default '',
    options_json text not null default '[]',
    expected_answer text not null default '',
    accepted_equivalents_json text not null default '[]',
    grading_rubric_json text not null default '[]',
    kg_grounding_json text not null default '{}',
    provider text not null default '',
    model text not null default '',
    prompt_tokens integer not null default 0 check(prompt_tokens >= 0),
    completion_tokens integer not null default 0 check(completion_tokens >= 0),
    total_tokens integer not null default 0 check(total_tokens >= 0),
    status text not null check(status in ('answerable','graded','generation_failed')),
    failure_code text not null default '',
    generated_at text not null
);

create index if not exists idx_test_questions_learner_topic_generated
on test_questions(learner_id, topic_id, generated_at desc);

create table if not exists test_attempts (
    id text primary key,
    question_id text not null unique,
    learner_id text not null,
    topic_id text not null,
    submitted_answer text not null,
    is_correct integer not null check(is_correct in (0,1)),
    score real not null check(score >= 0 and score <= 1),
    reason text not null,
    feedback text not null,
    progress_before integer not null check(progress_before between 0 and 10),
    progress_increment integer not null check(progress_increment in (0,1)),
    progress_after integer not null check(progress_after between 0 and 10),
    provider text not null default '',
    model text not null default '',
    prompt_tokens integer not null default 0 check(prompt_tokens >= 0),
    completion_tokens integer not null default 0 check(completion_tokens >= 0),
    total_tokens integer not null default 0 check(total_tokens >= 0),
    submitted_at text not null,
    foreign key(question_id) references test_questions(id)
);

create index if not exists idx_test_attempts_learner_topic_submitted
on test_attempts(learner_id, topic_id, submitted_at desc);

create table if not exists test_attempt_reservations (
    id text primary key,
    question_id text not null unique,
    learner_id text not null,
    submitted_answer text not null,
    reserved_at text not null,
    foreign key(question_id) references test_questions(id)
);

create index if not exists idx_test_attempt_reservations_reserved_at
on test_attempt_reservations(reserved_at);
