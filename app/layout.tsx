import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hosted Web App Template",
  description: "A hosted client-app starter for the bcns studio.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
