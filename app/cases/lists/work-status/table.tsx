import { normalizePointMan, param, type WorkStatusRow, type WorkStatusSort } from "@/lib/cases/presets";
import { CaseLink, Table } from "../ui";

export function readParams(sp: Record<string, string | string[] | undefined>): { pm: string; sort: WorkStatusSort } {
  return { pm: normalizePointMan(param(sp.pm)), sort: param(sp.sort) === "priority" ? "priority" : "due" };
}

export function WorkStatusTable({ rows }: { rows: WorkStatusRow[] }) {
  if (!rows.length) return <p className="text-sm text-slate-600">No cases match.</p>;
  return (
    <Table testId="work-status" head={["Case #", "Title", "Priority", "Point man", "Due date", "Due", "Status", "Waiting for"]}
      rows={rows.map((r) => ({ key: r.caseid, cells: [<CaseLink key="id" id={r.caseid} />, r.casetitle, r.casestatpriority, r.casestatpointman,
        r.casestatduedate, r.casestatduedatedescription, r.casestatdescription, r.casestatwaitingfor] }))} />
  );
}
