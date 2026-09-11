begin;

create schema if not exists consult;

create table if not exists consult.folders (
  id uuid primary key,
  owner_object_id text not null,
  parent_folder_id uuid null,
  name text not null check (char_length(name) between 1 and 120),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  unique (id, owner_object_id),
  foreign key (parent_folder_id, owner_object_id)
    references consult.folders(id, owner_object_id)
);

create table if not exists consult.conversations (
  id uuid primary key,
  owner_object_id text not null,
  folder_id uuid null,
  workspace text not null check (workspace = 'consult'),
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  unique (id, owner_object_id),
  foreign key (folder_id, owner_object_id)
    references consult.folders(id, owner_object_id)
);

create table if not exists consult.documents (
  id uuid primary key,
  owner_object_id text not null,
  classification text not null check (classification in ('session', 'controlled')),
  display_name text not null,
  state text not null check (state in ('uploading', 'stored', 'queued', 'processing', 'ready', 'duplicate', 'quarantined', 'failed', 'expired', 'deleted')),
  blob_container text not null,
  blob_name text not null,
  content_hash text null,
  size_bytes bigint not null check (size_bytes > 0),
  expires_at timestamptz null,
  safe_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  unique (id, owner_object_id),
  unique (blob_container, blob_name)
);

create table if not exists consult.document_versions (
  id uuid primary key,
  document_id uuid not null references consult.documents(id),
  version_number integer not null check (version_number > 0),
  index_name text not null,
  index_status text not null default 'pending',
  page_count integer null check (page_count is null or page_count > 0),
  extraction_version text null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (document_id, version_number)
);

create table if not exists consult.conversation_documents (
  conversation_id uuid not null,
  document_id uuid not null,
  owner_object_id text not null,
  created_at timestamptz not null default now(),
  primary key (conversation_id, document_id),
  foreign key (conversation_id, owner_object_id)
    references consult.conversations(id, owner_object_id),
  foreign key (document_id, owner_object_id)
    references consult.documents(id, owner_object_id)
);

create table if not exists consult.ingestion_jobs (
  id uuid primary key,
  document_version_id uuid not null references consult.document_versions(id),
  operation text not null check (operation in ('ingest', 'delete', 'promote')),
  state text not null,
  attempt_count integer not null default 0,
  correlation_id uuid not null,
  safe_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists consult.messages (
  id uuid primary key,
  conversation_id uuid not null references consult.conversations(id),
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  answer_mode text null,
  request_id uuid null,
  model_deployment text null,
  created_at timestamptz not null default now()
);

create table if not exists consult.message_citations (
  id uuid primary key,
  message_id uuid not null references consult.messages(id),
  citation_type text not null check (citation_type in ('controlled', 'attachment', 'general')),
  marker text not null,
  source_id text not null,
  title text not null,
  page_number integer null,
  section text null,
  excerpt text not null,
  source_uri text null,
  search_score double precision null,
  content_hash text null,
  created_at timestamptz not null default now()
);

create table if not exists consult.audit_events (
  id uuid primary key,
  owner_object_id text not null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid null,
  correlation_id uuid not null,
  safe_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ix_folders_owner_parent on consult.folders(owner_object_id, parent_folder_id) where deleted_at is null;
create unique index if not exists ux_folders_owner_parent_name
  on consult.folders(
    owner_object_id,
    coalesce(parent_folder_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  )
  where deleted_at is null;
create index if not exists ix_conversations_owner_folder on consult.conversations(owner_object_id, folder_id, updated_at desc) where deleted_at is null;
create index if not exists ix_documents_owner_state on consult.documents(owner_object_id, state) where deleted_at is null;
create index if not exists ix_jobs_state on consult.ingestion_jobs(state, created_at);

grant usage on schema consult to "ca-helmonic-consult-dev-002";
grant select, insert, update, delete on all tables in schema consult
  to "ca-helmonic-consult-dev-002";

commit;
