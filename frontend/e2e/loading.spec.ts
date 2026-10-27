import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

const token = "browser-test-token-at-least-32-characters";
async function example(page: Page, request: APIRequestContext) {
  const snapshot = await (
    await request.get("/api/snapshot", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const host = snapshot.sources.host.data;
  snapshot.sources.host = {
    status: "healthy",
    stale: false,
    updated_at: Date.now() / 1000,
    data: {
      ...host,
      hostname: "build-node-01",
      os: "Linux",
      scope: "host",
      cpu: {
        ...host.cpu,
        percent: 24.5,
        cores: 8,
        threads: 16,
        load: [3.8, 3.2, 2.9],
      },
      memory: {
        total: 32 * 2 ** 30,
        available: 24 * 2 ** 30,
        used: 8 * 2 ** 30,
        percent: 25,
        cached: 4 * 2 ** 30,
        swap_total: 0,
        swap_used: 0,
      },
      volumes: [
        {
          device: "/dev/example",
          mount: "/",
          fstype: "ext4",
          total: 100 * 2 ** 30,
          used: 30 * 2 ** 30,
          free: 70 * 2 ** 30,
          percent: 30,
          inode_percent: 3,
        },
      ],
      inventory: [],
      disks: [],
      network: [],
      temperatures: [],
      top_processes: [],
      processes: 100,
    },
  };
  snapshot.sources.docker.data = {
    version: "example",
    storage_driver: "overlay2",
    root: "/var/lib/docker",
    containers: [],
    images: [],
    total_containers: 0,
    ci_running: 0,
    worker_history: [],
  };
  snapshot.sources.gitlab = {
    status: "not_configured",
    data: null,
    stale: false,
    message: "Connect GitLab to see job timings.",
  };
  snapshot.sources.findings = {
    status: "not_configured",
    data: null,
    stale: false,
  };
  snapshot.sources.services = { status: "healthy", data: [], stale: false };
  snapshot.sources.gpu = { status: "not_configured", data: null, stale: false };
  snapshot.sources.runner = {
    status: "healthy",
    data: {
      metrics: { gitlab_runner_concurrent: 4 },
      facts: { concurrent: 4, runners: [] },
    },
    stale: false,
  };
  snapshot.alerts = [];
  snapshot.recommendations = [];
  snapshot.history_error = null;
  await page.addInitScript(
    (value) => sessionStorage.setItem("opsdeck.token", value),
    token,
  );
  await page.route("**/api/workloads?**", (route) =>
    route.fulfill({
      json: {
        scope: {},
        summary: {},
        rows: [],
        total: 0,
        page: 1,
        size: 10,
        catalog: { projects: [], pipelines: [], images: [] },
        worker_metadata: {},
        coverage: { gitlab_status: "not_configured", note: "Example workload" },
      },
    }),
  );
  await page.route("**/api/events", (route) => route.fulfill({ json: [] }));
  const history = [60, 30, 0].map((offset) => ({
    ts: Date.now() / 1000 - offset,
    cpu: 20,
    memory: 25,
    gpu: null,
    io_pressure: 0,
    rx: 0,
    tx: 0,
    queued: null,
  }));
  await page.route("**/api/history?**", (route) =>
    route.fulfill({ json: history }),
  );
  return snapshot;
}

test("shows loading and automatically recovers interrupted safe reads", async ({
  page,
  request,
}) => {
  const snapshot = await example(page, request);
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/snapshot", async (route) => {
    reads++;
    if (reads === 1) return route.abort("failed");
    if (reads === 2)
      return route.fulfill({
        status: 503,
        json: { detail: "Temporarily unavailable" },
      });
    await gate;
    await route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  await expect(
    page.getByText("Reconnecting automatically…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Loading host data" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../docs/images/walkthrough/loading.png",
    animations: "disabled",
  });
  release();
  await expect(
    page.getByRole("meter", { name: "Usage" }).first(),
  ).toHaveAttribute("aria-valuenow", "24.5");
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await expect(
    page.getByText("Host data is unavailable", { exact: true }),
  ).toHaveCount(0);
  expect(reads).toBeGreaterThanOrEqual(3);
});

test("keeps fresh readings when history fails and recovers with Retry now", async ({
  page,
  request,
}) => {
  const snapshot = await example(page, request);
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.goto("/");
  const meter = page.getByRole("meter", { name: "Usage" }).first();
  await expect(meter).toHaveAttribute("aria-valuenow", "24.5");
  await page.route("**/api/history?**", (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "History service temporarily unavailable" },
    }),
  );
  snapshot.sources.host.data.cpu.percent = 35;
  await page
    .getByRole("button", { name: "Refresh metrics", exact: true })
    .click();
  await expect(meter).toHaveAttribute("aria-valuenow", "35");
  await expect(
    page.getByText("Some data could not refresh", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("History: History service temporarily unavailable"),
  ).toBeVisible();
  await expect(page.locator(".loading-state")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "../docs/images/walkthrough/recovery.png",
    animations: "disabled",
  });
  await page.unroute("**/api/history?**");
  await page.getByRole("button", { name: "Retry now", exact: true }).click();
  await expect(
    page.getByText("Some data could not refresh", { exact: true }),
  ).toHaveCount(0);
  await expect(meter).toHaveAttribute("aria-valuenow", "35");
});

test("does not overlap host polls while an earlier read is still pending", async ({
  page,
  request,
}) => {
  const snapshot = await example(page, request);
  await page.clock.install();
  let reads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/snapshot", async (route) => {
    reads++;
    await gate;
    await route.fulfill({ json: snapshot });
  });
  await page.goto("/");
  await expect(
    page.getByRole("progressbar", { name: "Loading host data" }),
  ).toBeVisible();
  const initialReads = reads;
  await page.clock.fastForward(15000);
  expect(reads).toBe(initialReads);
  release();
  await expect(
    page.getByRole("meter", { name: "Usage" }).first(),
  ).toHaveAttribute("aria-valuenow", "24.5");
});
