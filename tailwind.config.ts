import type { Config } from "tailwindcss";
import preset from "@bcn-services/config/tailwind";

// The shared preset supplies the design tokens; each app supplies its own
// content globs. @bcn-services/ui ships raw src/*.tsx rather than a built bundle,
// so its source has to be scanned here or none of its classes are generated.
export default {
  presets: [preset],
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./node_modules/@bcn-services/ui/src/**/*.{ts,tsx}",
  ],
} satisfies Config;
