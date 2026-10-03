-- 0012: audit_log for the admin /audit page. Reads were open to every authenticated user (0005);
-- row data can hold anything in the firm's tables, so SELECT becomes admin-only. Inserts are
-- unaffected: nothing but the audit_row trigger (security definer, owner-run) writes here, and
-- there is still no insert/update/delete policy for any role.
drop policy audit_log_select_authenticated on audit_log;
create policy audit_log_select_admin on audit_log
  for select to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Serves the table / row-id filters on /audit (newest first = id desc within a row's history).
create index if not exists audit_log_table_row_idx on audit_log (tablename, rowid, id desc);
