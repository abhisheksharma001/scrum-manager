create table if not exists project_repos (
  id uuid primary key default gen_random_uuid(),
  project_key text not null,
  repo_full_name text not null,
  is_primary boolean not null default false,
  paths_hint text,
  created_at timestamptz not null default now(),
  unique (project_key, repo_full_name)
);

create table if not exists developer_briefs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references extracted_tasks(id) on delete cascade,
  tracker_issue_key text,
  status text not null default 'queued' check (
    status in (
      'queued',
      'analyzing',
      'awaiting_pm_review',
      'needs_human_direction',
      'sending',
      'sent',
      'rejected',
      'failed'
    )
  ),
  repos text[] not null default '{}',
  analyzed_commit_sha text,
  candidate_files jsonb not null default '[]',
  brief jsonb,
  confidence text check (confidence in ('high', 'medium', 'low', 'none')),
  missing_info jsonb not null default '[]',
  model text,
  token_usage jsonb,
  tool_calls integer not null default 0,
  bytes_read integer not null default 0,
  attempt integer not null default 0,
  pm_reviewer uuid references users(id),
  pm_reviewed_at timestamptz,
  pm_action text,
  delivery jsonb not null default '{}',
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id)
);

create table if not exists brief_status_history (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references developer_briefs(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid references users(id),
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_repos_project_key on project_repos(project_key);
create index if not exists idx_developer_briefs_status on developer_briefs(status);
create index if not exists idx_developer_briefs_task on developer_briefs(task_id);
create index if not exists idx_brief_status_history_brief on brief_status_history(brief_id);

create trigger trg_developer_briefs_updated_at
  before update on developer_briefs for each row execute function update_updated_at();

create or replace function record_brief_status_change()
returns trigger as $$
begin
  if old.status is distinct from new.status then
    insert into brief_status_history (brief_id, old_status, new_status, changed_by, reason)
    values (new.id, old.status, new.status, new.pm_reviewer, null);
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_brief_status_change
  after update on developer_briefs for each row execute function record_brief_status_change();

alter table project_repos enable row level security;
alter table developer_briefs enable row level security;
alter table brief_status_history enable row level security;

create policy project_repos_select on project_repos for select using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);
create policy project_repos_modify on project_repos for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
) with check (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

create policy developer_briefs_select on developer_briefs for select using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);
create policy developer_briefs_modify on developer_briefs for all using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
) with check (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

create policy brief_status_history_select on brief_status_history for select using (
  exists (select 1 from users u where u.id = auth.uid() and u.role = 'admin')
);

insert into pipeline_config (key, value)
values
  ('brief_approval_mode', '"gate"'),
  ('auto_send_min_confidence', '"high"'),
  ('brief_budget', '{"maxQueries":6,"maxFiles":8,"maxBytesPerFile":40000,"maxTotalBytes":200000,"maxToolCalls":25}')
on conflict (key) do nothing;
