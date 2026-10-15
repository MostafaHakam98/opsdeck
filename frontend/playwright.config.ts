import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8082",
    headless: true,
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "cd .. && .venv/bin/python -m backend.run",
    url: "http://127.0.0.1:8082/healthz",
    timeout: 30000,
    env: {
      OPSDECK_TOKEN: "browser-test-token-at-least-32-characters",
      OPSDECK_BIND: "127.0.0.1",
      OPSDECK_PORT: "8082",
      OPSDECK_DB: "/tmp/opsdeck-e2e.sqlite",
      OPSDECK_FINDINGS_PATH: "/tmp/opsdeck-e2e-no-private-survey.json",
      DOCKER_HOST: "unix:///tmp/opsdeck-missing.sock",
      GITLAB_URL: "",
      GITLAB_TOKEN: "",
      GITLAB_PROJECT_IDS: "",
      OPSDECK_GITLAB_CONNECTION_FILE: "/tmp/opsdeck-e2e-no-gitlab.json",
    },
  },
});
