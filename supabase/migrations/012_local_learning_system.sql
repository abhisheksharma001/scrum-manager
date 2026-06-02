-- Local-only learning layer for PM feedback, repo cataloging, and routing decisions.

alter table transcripts
  add column if not exists owner_user_id uuid references users(id);

alter table extracted_tasks
  add column if not exists owner_user_id uuid references users(id);

alter table project_repos
  add column if not exists owner_user_id uuid references users(id);

alter table developer_briefs
  add column if not exists owner_user_id uuid references users(id);

create index if not exists idx_transcripts_owner on transcripts(owner_user_id);
create index if not exists idx_extracted_tasks_owner on extracted_tasks(owner_user_id);
create index if not exists idx_project_repos_owner on project_repos(owner_user_id);
create index if not exists idx_developer_briefs_owner on developer_briefs(owner_user_id);

create table if not exists learning_feedback_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  task_id uuid references extracted_tasks(id) on delete set null,
  brief_id uuid references developer_briefs(id) on delete set null,
  event_type text not null check (
    event_type in ('correction', 'approval', 'rejection', 'comment', 'repo_override', 'assignee_fix')
  ),
  scope text not null default 'just_this_ticket' check (scope in ('just_this_ticket', 'teach_system')),
  note text,
  corrections jsonb not null default '{}',
  previous_values jsonb not null default '{}',
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  created_at timestamptz not null default now()
);

create table if not exists learning_memories (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  source_feedback_event_id uuid references learning_feedback_events(id) on delete set null,
  status text not null default 'pending' check (status in ('active', 'pending', 'inactive')),
  memory_type text not null check (
    memory_type in ('project_route', 'repo_route', 'path_route', 'assignee_preference', 'team_note')
  ),
  pattern text not null,
  target jsonb not null default '{}',
  confidence numeric not null default 0.6 check (confidence >= 0 and confidence <= 1),
  evidence_count integer not null default 1,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists repo_catalog_entries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  repo_name text not null,
  local_path text not null,
  project_key text,
  description text,
  readme_title text,
  package_metadata jsonb not null default '{}',
  important_paths jsonb not null default '[]',
  file_tree jsonb not null default '[]',
  search_text text not null default '',
  indexed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, local_path)
);

create table if not exists task_routing_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references users(id) on delete cascade,
  task_id uuid not null references extracted_tasks(id) on delete cascade,
  project_key text,
  repo_matches jsonb not null default '[]',
  assignee text,
  path_matches jsonb not null default '[]',
  confidence numeric not null default 0,
  source text not null check (
    source in ('correction', 'memory', 'project_mapping', 'repo_catalog', 'ai_router', 'fallback', 'pm_review')
  ),
  explanation text not null default '',
  alternatives jsonb not null default '[]',
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_learning_feedback_owner on learning_feedback_events(owner_user_id, created_at desc);
create index if not exists idx_learning_feedback_task on learning_feedback_events(task_id);
create index if not exists idx_learning_memories_owner_status on learning_memories(owner_user_id, status);
create index if not exists idx_repo_catalog_owner_project on repo_catalog_entries(owner_user_id, project_key);
create index if not exists idx_task_routing_task on task_routing_decisions(task_id, created_at desc);

create trigger trg_learning_memories_updated_at
  before update on learning_memories for each row execute function update_updated_at();

create trigger trg_repo_catalog_entries_updated_at
  before update on repo_catalog_entries for each row execute function update_updated_at();

alter table learning_feedback_events enable row level security;
alter table learning_memories enable row level security;
alter table repo_catalog_entries enable row level security;
alter table task_routing_decisions enable row level security;

create policy learning_feedback_events_owner on learning_feedback_events for all using (
  owner_user_id = auth.uid()
  or exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
) with check (
  owner_user_id = auth.uid()
  or exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

create policy learning_memories_owner on learning_memories for all using (
  owner_user_id = auth.uid()
  or exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
) with check (
  owner_user_id = auth.uid()
  or exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

create policy repo_catalog_entries_owner on repo_catalog_entries for all using (
  owner_user_id = auth.uid()
  or exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
) with check (
  owner_user_id = auth.uid()
  or exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

create policy task_routing_decisions_owner on task_routing_decisions for all using (
  owner_user_id = auth.uid()
  or exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
) with check (
  owner_user_id = auth.uid()
  or exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

insert into pipeline_config (key, value)
values ('default_local_owner_user_id', 'null')
on conflict (key) do nothing;
