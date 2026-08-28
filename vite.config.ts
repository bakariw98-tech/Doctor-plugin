import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// INPUT selects which HTML entry to build (mcp-app.html or index.html);
// OUTDIR lets the two builds land in different folders (dist/ for the
// widget bundle that gets embedded into the server, public/ for the
// static demo site Vercel serves at the root).
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: process.env.OUTDIR ?? "dist",
    emptyOutDir: false,
    rollupOptions: {
      input: process.env.INPUT,
    },
  },
});
