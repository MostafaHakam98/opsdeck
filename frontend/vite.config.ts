import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8080" } },
  build: {
    rollupOptions: {
      output: {
        // Keep shared React dependencies out of the chart-only chunk.
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          if (id.includes("/node_modules/recharts/")) return "charts";
        },
      },
    },
  },
});
