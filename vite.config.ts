// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  vite: {
    build: {
      sourcemap: true,
      rollupOptions: {
        output: {
          // Split heavy vendor deps into separate chunks so the initial
          // client bundle is smaller and chunks cache independently across deploys.
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("recharts") || id.includes("d3-")) return "vendor-charts";
            if (id.includes("emoji-picker-react")) return "vendor-emoji";
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("@supabase")) return "vendor-supabase";
            if (id.includes("@tanstack")) return "vendor-tanstack";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("date-fns")) return "vendor-date";
            if (id.includes("react-hook-form") || id.includes("@hookform") || id.includes("zod")) return "vendor-forms";
            if (id.includes("@dnd-kit")) return "vendor-dnd";
          },
        },
      },
    },
  },
});
