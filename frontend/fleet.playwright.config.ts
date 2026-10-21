import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "fleet.e2e.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8083",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "cd .. && .venv/bin/python -m backend.run",
    url: "http://127.0.0.1:8083/healthz",
    timeout: 30000,
    env: {
      OPSDECK_MODE: "central",
      OPSDECK_TOKEN: "fleet-browser-test-token-at-least-32-characters",
      OPSDECK_BIND: "127.0.0.1",
      OPSDECK_PORT: "8083",
      OPSDECK_DB: "/tmp/opsdeck-fleet-e2e.sqlite",
      OPSDECK_ACTIONS: "false",
      OPSDECK_OPERATIONS: "false",
    },
  },
});
