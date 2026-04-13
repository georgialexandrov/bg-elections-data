import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import path from "path";

export default defineConfig({
  build: {
    sourcemap: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    process.env.SENTRY_AUTH_TOKEN
      ? sentryVitePlugin({
          org: "elections-ip",
          project: "javascript-react",
          sourcemaps: {
            filesToDeleteAfterUpload: ["./dist/assets/*.map"],
          },
        })
      : null,
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
