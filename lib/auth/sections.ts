/** The nine app sections, shared by the header nav and the landing page. Plain routes only. */
export const SECTIONS = [
  { href: "/cases", label: "Cases" },
  { href: "/time", label: "Time" },
  { href: "/bills", label: "Bills" },
  { href: "/expenses", label: "Expenses" },
  { href: "/funds", label: "Funds" },
  { href: "/bank-review", label: "Bank review" },
  { href: "/documents", label: "Documents" },
  { href: "/reports", label: "Reports" },
  { href: "/dashboard", label: "Dashboard" },
] as const;
