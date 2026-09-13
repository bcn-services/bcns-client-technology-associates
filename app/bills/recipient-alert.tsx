/**
 * Case recipient warning on the bill screens: a banner when `tblcase.billingalert` is true, and a "CC:" line whenever
 * `billingcc` has text (with or without the alert). Display only — the cases lane owns and writes both columns.
 */
export function RecipientAlert({ alert, cc }: { alert: boolean | null | undefined; cc: string | null | undefined }) {
  const copy = cc?.trim();
  if (!alert && !copy) return null;
  return (
    <div className="space-y-1">
      {alert && (
        <p data-testid="bill-recipient-alert" className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          Bill recipient alert — this case bills a different party
        </p>
      )}
      {copy && <p data-testid="bill-recipient-cc" className="text-sm">{`CC: ${copy}`}</p>}
    </div>
  );
}
