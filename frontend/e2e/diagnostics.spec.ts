import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

const token = "browser-test-token-at-least-32-characters";
const many = (make: (index: number) => any) =>
  Array.from({ length: 23 }, (_, index) => make(index));

async function fixture(page: Page, request: APIRequestContext) {
  const snapshot = await (
    await request.get("/api/snapshot", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const now = Date.now() / 1000;
  const source = (data: any) => ({
    status: "healthy",
    stale: false,
    updated_at: now,
    age_seconds: 0,
    message: null,
    data,
  });
  snapshot.alerts = many((i) => ({
    key: `alert-${i}`,
    title: `Support condition ${i}`,
    detail: "Review the affected resource",
    severity: "warning",
  }));
  snapshot.recommendations = many((i) => ({
    key: `rec-${i}`,
    title: `Recommendation ${i}`,
    category: "Storage",
    status: "verify",
    evidence: "Collected evidence",
    next: "Compare workload timings",
  }));
  snapshot.sources.host = source({
    hostname: "support-node",
    scope: "native",
    os: "Linux",
    boot_time: now - 1000,
    processes: 23,
    cpu: { percent: 40, cores: 8, threads: 16, load: [1, 2, 3] },
    memory: { percent: 60, total: 64 * 1024 ** 3, available: 24 * 1024 ** 3 },
    pressure: { io: { some: { avg60: 2 } } },
    volumes: many((i) => ({
      mount: `/data/${i}`,
      device: `disk-${i}`,
      fstype: "ext4",
      total: 1000,
      free: 500,
      percent: i === 22 ? 96 : 50,
      inode_percent: 20,
    })),
    inventory: many((i) => ({ name: `disk-${i}`, size: 1000, rota: false })),
    disks: many((i) => ({
      name: `disk-${i}`,
      read_bytes_s: 100,
      write_bytes_s: 200,
      iops: 2,
      await_ms: 3,
      busy_percent: 4,
    })),
    network: many((i) => ({
      name: i === 22 ? "veth-test" : `eth${i}`,
      up: true,
      speed_mbps: 1000,
      errors: 0,
      drops: 0,
      rx_bytes_s: 1024,
      tx_bytes_s: 2048,
    })),
    top_processes: many((i) => ({
      name: `process-${i}`,
      pid: i + 1,
      memory_bytes: 1000,
      cpu_percent: 1,
    })),
    temperatures: many((i) => ({ label: `Sensor ${i}`, current: 40 })),
  });
  snapshot.sources.services = source(
    many((i) => ({
      name: `service-${i}`,
      state: "active",
      load: "loaded",
      substate: "running",
      memory_bytes: 1000,
      exit_code: 0,
    })),
  );
  snapshot.sources.gpu = source([]);
  snapshot.sources.runner = source({
    facts: {
      concurrent: 16,
      runners: many((i) => ({
        name: `registration-${i}`,
        executor: "docker",
        limit: 1,
        request_concurrency: 1,
      })),
    },
    metrics: Object.fromEntries(many((i) => [`metric_${i}`, i])),
  });
  const jobs = many((i) => ({
    id: i + 1000,
    name: `build-${i}`,
    project_id: 1,
    project: "team/support",
    pipeline: i + 100,
    status: i === 22 ? "failed" : "success",
    duration: i * 10,
    queued_duration: i === 0 ? null : i,
    url: `https://gitlab.example/jobs/${i}`,
  }));
  const pipelines = many((i) => ({
    id: i + 100,
    project_id: 1,
    project: "team/support",
    status: i === 22 ? "failed" : "success",
    duration: i * 10,
    queued_duration: i,
    ref: "devel",
    url: `https://gitlab.example/pipelines/${i}`,
  }));
  snapshot.sources.gitlab = source({
    pipelines,
    jobs,
    projects: [{ id: 1, name: "team/support" }],
  });
  snapshot.sources.docker = source({
    ci_running: 0,
    containers: [],
    images: [],
    worker_history: [],
    storage: {
      volumes: many((i) => ({
        name: `cache-${i}`,
        driver: "local",
        size_bytes: 1000,
        references: 1,
        mountpoint: `/volumes/${i}`,
      })),
    },
  });
  snapshot.sources.findings = source({
    title: "Support survey",
    recorded_on: "2026-01-01",
    imported_at: now,
    source_name: "Test survey",
    source_report: "Recorded test evidence",
    context: {},
    benchmarks: many((i) => ({
      pipeline_id: i + 300,
      label: `Round ${i}`,
      status: "success",
      runner_seconds: 500 - i,
      wall_seconds: 300 - i,
      queue_seconds: 0,
      passed_jobs: 23,
      total_jobs: 23,
      evidence: "Measured",
      jobs: many((j) => ({
        name: `recorded-${i}-${j}`,
        status: "success",
        duration: j,
        stage: "test",
      })),
    })),
    job_comparisons: many((i) => ({
      name: `comparison-${i}`,
      seconds: many((j) => 100 - j),
    })),
    measurements: many((i) => ({
      title: `Measurement ${i}`,
      kind: "measured",
      before: "100s",
      after: "90s",
      evidence: "Measured",
    })),
    optimizations: many((i) => ({
      key: `opt-${i}`,
      title: `Optimization ${i}`,
      recorded_status: "prepared",
      current_check: { status: "verified", detail: "Checked" },
    })),
    notes: many((i) => `Follow-up ${i}`),
    image_checks: many((i) => ({ tag: `toolchain:${i}`, present: true })),
  });
  const history = [
    {
      ts: now - 120,
      cpu: 20,
      cpu_peak: 95,
      memory: 50,
      memory_peak: 60,
      io_pressure: 2,
      io_pressure_peak: 5,
      queued: 0,
      gpu: null,
      rx: 1024,
      tx: 2048,
    },
    {
      ts: now - 60,
      cpu: null,
      memory: null,
      io_pressure: null,
      queued: null,
      gpu: null,
      rx: null,
      tx: null,
    },
    {
      ts: now,
      cpu: 40,
      cpu_peak: 50,
      memory: 70,
      memory_peak: 80,
      io_pressure: 12,
      io_pressure_peak: 20,
      queued: 4,
      gpu: null,
      rx: 4096,
      tx: 1024,
    },
  ];
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/history?**", (route) =>
    route.fulfill({ json: history }),
  );
  await page.route("**/api/workloads?**", (route) =>
    route.fulfill({
      json: {
        scope: { project: "all", pipeline: "all", image: "all", hours: 24 },
        summary: {},
        rows: [],
        total: 0,
        page: 1,
        size: 20,
        catalog: {
          projects: [{ id: "1", name: "team/support" }],
          pipelines: [],
          images: [],
        },
        worker_metadata: {},
        coverage: { gitlab_status: "healthy", note: "Test evidence" },
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Access token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  return { snapshot, history };
}

async function navigate(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

async function checkTable(page: Page, label: string) {
  const list = page.getByRole("group", { name: label, exact: true });
  await expect(list.locator("tbody tr")).toHaveCount(10);
  await expect(
    list.getByRole("button", { name: "Previous page", exact: true }),
  ).toBeDisabled();
  await list.getByRole("button", { name: "Next page", exact: true }).click();
  await list.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(list.locator("tbody tr")).toHaveCount(3);
  await expect(list.getByText("21–23 of 23", { exact: true })).toBeVisible();
  await expect(
    list.getByRole("button", { name: "Next page", exact: true }),
  ).toBeDisabled();
  await list
    .getByLabel(`${label} rows per page`, { exact: true })
    .selectOption("20");
  await expect(list.locator("tbody tr")).toHaveCount(20);
  await expect(
    list.getByRole("button", { name: "Previous page", exact: true }),
  ).toBeDisabled();
}

test("diagnostic plots preserve peaks and gaps with usable light, dark and mobile layouts", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await fixture(page, request);
  const resources = page.getByRole("region", {
    name: "Resource diagnostics",
    exact: true,
  });
  await expect(resources.getByText("30.0%", { exact: true })).toBeVisible();
  await expect(resources.getByText(/Peak 95.0%/)).toBeVisible();
  await expect(resources.getByText(/2\/3 measured/).first()).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Storage pressure timeline with a 10 percent guide",
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("img", {
        name: "Storage pressure timeline with a 10 percent guide",
      })
      .locator(".recharts-line-dot"),
  ).toHaveCount(2);
  await expect(
    resources
      .getByRole("group", { name: "Filesystem risk", exact: true })
      .locator(".filesystem-risk")
      .first(),
  ).toContainText("/data/22");
  await page.screenshot({
    path: "../.tmp/diagnostics-light.png",
    fullPage: true,
  });
  await page.getByRole("radio", { name: "Dark theme" }).click();
  await page.screenshot({
    path: "../.tmp/diagnostics-dark.png",
    fullPage: true,
  });
  await navigate(page, "Projects & pipelines");
  const pipelines = page.getByRole("region", {
    name: "Pipeline diagnostics",
    exact: true,
  });
  await expect(
    pipelines.getByRole("img", {
      name: /Pipeline outcomes: Successful 22, Failed 1/,
    }),
  ).toBeVisible();
  await expect(
    pipelines
      .locator(".diagnostic-metrics")
      .getByText("95.7%", { exact: true }),
  ).toBeVisible();
  await expect(pipelines.getByText("3m 20s", { exact: true })).toBeVisible();
  await expect(pipelines.getByText("21s", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "../.tmp/diagnostics-pipelines.png",
    fullPage: true,
  });
  const jobChart = page.getByRole("group", {
    name: "Job timing chart",
    exact: true,
  });
  await jobChart
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  await expect(jobChart.getByText("6–10 of 23", { exact: true })).toBeVisible();
  await expect(jobChart.locator(".timing-details p")).toHaveCount(5);
  for (const name of [
    "Overview",
    "Host & hardware",
    "Runner stack",
    "Projects & pipelines",
    "Survey & benchmarks",
    "Optimization",
    "Activity & audit",
    "Connections",
  ]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await navigate(page, name);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      name,
    ).toBe(true);
  }
  await navigate(page, "Overview");
  await page.screenshot({
    path: "../.tmp/diagnostics-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("host lists paginate independently, resize, and clamp after a live refresh", async ({
  page,
  request,
}) => {
  const { snapshot } = await fixture(page, request);
  await navigate(page, "Host & hardware");
  for (const label of [
    "Filesystems",
    "Devices",
    "Physical disks",
    "System services",
    "Processes",
  ])
    await checkTable(page, label);
  const services = page.getByRole("group", {
    name: "System services",
    exact: true,
  });
  const originalServices = snapshot.sources.services.data;
  await services
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  snapshot.sources.services.data = snapshot.sources.services.data.slice(0, 3);
  await page
    .getByRole("button", { name: "Refresh metrics", exact: true })
    .click();
  await expect(services.locator("tbody tr")).toHaveCount(3);
  await expect(services.getByText("1–3 of 3", { exact: true })).toBeVisible();
  snapshot.sources.services.data = originalServices;
  await page
    .getByRole("button", { name: "Refresh metrics", exact: true })
    .click();
  await expect(services.getByText("1–20 of 23", { exact: true })).toBeVisible();
  snapshot.sources.services.data = [];
  await page
    .getByRole("button", { name: "Refresh metrics", exact: true })
    .click();
  await expect(services.getByText("0 results", { exact: true })).toBeVisible();
  const interfaces = page.getByRole("group", {
    name: "Network interfaces",
    exact: true,
  });
  await interfaces
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  await navigate(page, "Show virtual interfaces");
  await expect(
    interfaces.getByText("Page 1 of 3", { exact: true }),
  ).toBeVisible();
});

test("runner and GitLab lists paginate and job filters return to page one", async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await navigate(page, "Runner stack");
  for (const label of [
    "Runner registrations",
    "GitLab pipelines",
    "GitLab jobs",
  ])
    await checkTable(page, label);
  await page.getByText("Collected runner metrics", { exact: true }).click();
  await checkTable(page, "Runner metrics");
  const jobs = page.getByRole("group", { name: "GitLab jobs", exact: true });
  await jobs.getByRole("button", { name: "Next page", exact: true }).click();
  await page.getByLabel("Search jobs", { exact: true }).fill("build-22");
  await expect(jobs.locator("tbody tr")).toHaveCount(1);
  await expect(jobs.getByText("1–1 of 1", { exact: true })).toBeVisible();
  await page.getByLabel("Job status", { exact: true }).selectOption("pending");
  await expect(jobs.getByText("0 results", { exact: true })).toBeVisible();
  await expect(
    jobs.getByText("No records available for this selection."),
  ).toBeVisible();
});

test("survey pagination preserves pipeline drilldowns and all retained evidence", async ({
  page,
  request,
}) => {
  await fixture(page, request);
  await navigate(page, "Survey & benchmarks");
  await checkTable(page, "Benchmark pipelines");
  const benchmarks = page.getByRole("group", {
    name: "Benchmark pipelines",
    exact: true,
  });
  await benchmarks
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  await benchmarks.getByRole("button", { name: "#322", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Recorded jobs · #322", exact: true }),
  ).toBeVisible();
  await checkTable(page, "Recorded jobs");
  await checkTable(page, "Survey measurements");
  await checkTable(page, "Recorded optimizations");
  await page.getByText("Job-by-job timing comparison", { exact: true }).click();
  await checkTable(page, "Job timing comparisons");
  await page
    .getByText("Recorded notes and follow-ups", { exact: true })
    .click();
  const notes = page.getByRole("group", {
    name: "Survey follow-ups",
    exact: true,
  });
  await notes.getByRole("button", { name: "Next page", exact: true }).click();
  await notes.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(notes.getByText("Follow-up 22", { exact: true })).toBeVisible();
});

test("stale and absent telemetry cannot appear as current healthy diagnostic results", async ({
  page,
  request,
}) => {
  const { snapshot, history } = await fixture(page, request);
  snapshot.sources.host.stale = true;
  snapshot.sources.gitlab.stale = true;
  history.splice(0);
  await page
    .getByRole("button", { name: "Refresh metrics", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Confirm the host connection",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/Current host telemetry is stale or unavailable/),
  ).toBeVisible();
  await expect(
    page.getByText(/Waiting for two measured storage-pressure samples/),
  ).toBeVisible();
  await expect(
    page.getByText("Queue history is unavailable", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Projects & pipelines");
  await expect(
    page.getByText(/GitLab data is stale or unavailable/),
  ).toBeVisible();
  snapshot.sources.gitlab = {
    status: "not_configured",
    stale: false,
    data: null,
    message: "Set GITLAB_URL",
  };
  await page
    .getByRole("button", { name: "Refresh metrics", exact: true })
    .click();
  await expect(
    page.getByText(/GitLab is not connected for this host/),
  ).toBeVisible();
  await expect(
    page.getByText(/GitLab data is stale or unavailable/),
  ).toHaveCount(0);
});

test("alerts, recommendations, interfaces, sensors and cache lists keep every record reachable", async ({
  page,
  request,
}) => {
  const { snapshot } = await fixture(page, request);
  const attention = page.getByRole("group", {
    name: "Attention items",
    exact: true,
  });
  await attention
    .getByLabel("Attention items rows per page", { exact: true })
    .selectOption("50");
  await expect(
    attention.getByText("Support condition 22", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Activity & audit");
  const alerts = page.getByRole("group", {
    name: "Active conditions",
    exact: true,
  });
  await alerts.getByRole("button", { name: "Next page", exact: true }).click();
  await alerts.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    alerts.getByText("Support condition 22", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Optimization");
  const recommendations = page.getByRole("group", {
    name: "Recommendations",
    exact: true,
  });
  await recommendations
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  await recommendations
    .getByRole("button", { name: "Next page", exact: true })
    .click();
  await expect(
    recommendations.getByText("Recommendation 22", { exact: true }),
  ).toBeVisible();
  await navigate(page, "Host & hardware");
  const sensors = page.getByRole("group", {
    name: "Temperature sensors",
    exact: true,
  });
  await sensors.getByRole("button", { name: "Next page", exact: true }).click();
  await sensors.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    sensors.getByText("Sensor 22: 40 °C", { exact: true }),
  ).toBeVisible();
  snapshot.sources.gpu.data = many((i) => ({
    index: i,
    name: `GPU ${i}`,
    utilization: 0,
    memory_used_mib: 0,
    memory_total_mib: 1000,
  }));
  await page
    .getByRole("button", { name: "Refresh metrics", exact: true })
    .click();
  const gpus = page.getByRole("group", { name: "GPU devices", exact: true });
  await gpus.getByRole("button", { name: "Next page", exact: true }).click();
  await gpus.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    gpus.getByRole("heading", { name: "GPU 22", exact: true }),
  ).toBeVisible();
  await navigate(page, "Runner stack");
  await page
    .getByText("Runner cache and Docker volumes", { exact: true })
    .click();
  await checkTable(page, "Cache volumes");
  await page
    .getByText("Survey toolchain availability", { exact: true })
    .click();
  await checkTable(page, "Toolchain availability");
});
