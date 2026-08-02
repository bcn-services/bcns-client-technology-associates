import { PRICING, formatUsd, monthlyCharge } from "@nseluga/app-core";
import { isAiEnabled } from "@/lib/ai";

// Proves the three workspace:* deps resolve and the app renders 200 with no
// keys set and the AI flag off.
export default function HomePage() {
  const aiOn = isAiEnabled();
  const standard = monthlyCharge("standard", 20);

  return (
    <main>
      <h1>Hosted Web App Template</h1>
      <p>
        A runnable starter for a hosted client app. AI features are{" "}
        <strong>{aiOn ? "enabled" : "disabled"}</strong> (set <code>AI_ENABLED=1</code> to opt in).
      </p>
      <p>
        Standard plan base: {formatUsd(PRICING.standard.monthlyCents)}/mo. At 20 seats:{" "}
        {formatUsd(standard.totalCents)}/mo.
      </p>
    </main>
  );
}
