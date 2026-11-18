begin;

alter table consult.message_citations
  drop constraint if exists message_citations_citation_type_check;

alter table consult.message_citations
  add constraint message_citations_citation_type_check
  check (citation_type in ('controlled', 'attachment', 'general', 'web'));

commit;
