-- Approval-gated task flow: repo-aware briefs before Jira creation.

alter table extracted_tasks
  add column if not exists work_type text not null default 'unclear',
  add column if not exists repo_context_needed boolean not null default false,
  add column if not exists approval_status text not null default 'not_ready',
  add column if not exists approved_by uuid references users(id),
  add column if not exists approved_at timestamptz,
  add column if not exists assigned_developer_name text,
  add column if not exists assigned_developer_email text,
  add column if not exists repo_confidence numeric,
  add column if not exists routing_confidence numeric;

alter table extracted_tasks
  drop constraint if exists extracted_tasks_work_type_check,
  add constraint extracted_tasks_work_type_check
    check (work_type in ('code', 'non_code', 'unclear'));

alter table extracted_tasks
  drop constraint if exists extracted_tasks_approval_status_check,
  add constraint extracted_tasks_approval_status_check
    check (approval_status in ('not_ready', 'awaiting_approval', 'approved', 'rejected'));

alter table extracted_tasks
  drop constraint if exists extracted_tasks_status_check,
  add constraint extracted_tasks_status_check check (
    status in (
      'pending_interview',
      'claimed',
      'completed',
      'dismissed',
      'auto_created',
      'expired',
      'jira_failed',
      'pending_repo_analysis',
      'awaiting_approval',
      'approved',
      'jira_created',
      'delivery_failed'
    )
  );

update extracted_tasks
set
  status = 'awaiting_approval',
  approval_status = 'awaiting_approval'
where status = 'auto_created';

create index if not exists idx_extracted_tasks_approval_status on extracted_tasks(approval_status);
create index if not exists idx_extracted_tasks_work_type on extracted_tasks(work_type);

