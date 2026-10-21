import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
const token = "browser-test-token-at-least-32-characters";
async function signIn(page: any) {
  await page.goto("/");
  await page.getByLabel("Access token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
}
test("local header opens the fleet without carrying the local access token", async ({
  page,
  request,
}) => {
  const snapshot = await (
    await request.get("/api/snapshot", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({
      json: { ...snapshot, fleet_url: "https://fleet.example.com" },
    }),
  );
  let leakedToken = false;
  await page.route("https://fleet.example.com/**", async (route) => {
    leakedToken ||=
      !!route.request().headers().authorization ||
      route.request().url().includes(token);
    await route.fulfill({
      contentType: "text/html",
      body: "<h1>Fleet dashboard</h1>",
    });
  });
  await signIn(page);
  const picker = page.getByRole("combobox", { name: "Switch host" });
  await expect(picker).toHaveValue("local");
  await expect(
    picker.getByRole("option", { name: "All hosts (open fleet)", exact: true }),
  ).toBeEnabled();
  await picker.selectOption("");
  await expect(
    page.getByRole("heading", { name: "Fleet dashboard" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => sessionStorage.getItem("opsdeck.token")),
  ).toBeNull();
  expect(leakedToken).toBe(false);
});

test("real API authentication, hardware, all pages, and unavailable integrations", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  expect((await request.get("/api/snapshot")).status()).toBe(401);
  await signIn(page);
  await expect(
    page.getByText("CPU utilization", { exact: true }),
  ).toBeVisible();
  for (const name of [
    "Host & hardware",
    "Docker",
    "Runner stack",
    "Survey & benchmarks",
    "Optimization",
    "Activity & audit",
    "Connections",
  ]) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByText("not configured", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({
    path: "../.tmp/opsdeck-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Open your workspace" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("container action requires preview and exact typed confirmation", async ({
  page,
  request,
}) => {
  let executed = false;
  const response = await request.get("/api/snapshot", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const template = await response.json();
  await page.route("**/api/snapshot", async (route) => {
    const snapshot = structuredClone(template);
    snapshot.actions_enabled = true;
    snapshot.sources.docker = {
      status: "healthy",
      stale: false,
      updated_at: Date.now() / 1000,
      data: {
        version: "test",
        storage_driver: "overlay2",
        total_containers: 1,
        containers: [
          {
            id: "a".repeat(64),
            name: "test-service",
            image: "example:test",
            state: "running",
            status: "Up",
            managed: true,
            ci: false,
          },
        ],
      },
    };
    await route.fulfill({ json: snapshot });
  });
  await page.route("**/api/actions/preview", (route) =>
    route.fulfill({
      json: {
        nonce: "test-nonce",
        action: "restart",
        target: "a".repeat(64),
        name: "test-service",
        confirmation: "restart test-service",
        expires_at: Date.now() / 1000 + 60,
        impact: "Test operation",
      },
    }),
  );
  await page.route("**/api/actions/execute", async (route) => {
    executed = true;
    expect(route.request().postDataJSON().confirmation).toBe(
      "restart test-service",
    );
    await route.fulfill({ json: { message: "Test operation completed" } });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm restart", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Confirmation", { exact: true })
    .fill("restart test-service");
  await page
    .getByRole("button", { name: "Confirm restart", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(executed).toBe(true);
});
test("mobile layout remains usable without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Host & hardware", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Host & hardware", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../.tmp/opsdeck-mobile.png", fullPage: true });
});

test("survey evidence and observed worker history remain distinct", async ({
  page,
  request,
}) => {
  const template = await (
    await request.get("/api/snapshot", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  await page.route("**/api/snapshot", async (route) => {
    const snapshot = structuredClone(template);
    snapshot.sources.findings = {
      status: "healthy",
      updated_at: Date.now() / 1000,
      data: {
        title: "Example runner survey",
        recorded_on: "2026-01-01",
        source_name: "Private operator report",
        imported_at: Date.now() / 1000,
        context: { Machine: "Example workstation" },
        benchmarks: [
          {
            pipeline_id: 100,
            label: "Baseline",
            status: "success",
            runner_seconds: 180,
            wall_seconds: 120,
            queue_seconds: 0,
            passed_jobs: 1,
            total_jobs: 1,
            evidence: "Recorded evidence",
            jobs: [{ name: "example-build", status: "success", duration: 180 }],
          },
          {
            pipeline_id: 101,
            label: "Interrupted",
            status: "canceled",
            runner_seconds: null,
            wall_seconds: null,
            queue_seconds: null,
            passed_jobs: null,
            total_jobs: null,
            evidence: "Recorded evidence",
            jobs: [],
          },
          {
            pipeline_id: 102,
            label: "Optimized",
            status: "success",
            runner_seconds: 60,
            wall_seconds: 30,
            queue_seconds: 120,
            passed_jobs: 1,
            total_jobs: 1,
            evidence: "Recorded evidence",
            jobs: [{ name: "example-build", status: "success", duration: 60 }],
          },
        ],
        job_comparisons: [
          { name: "example-build", seconds: [180, 60] },
          {
            name: "example-lint",
            seconds: [30, 60],
            note: "Cold-cache result",
          },
        ],
        measurements: [
          {
            title: "Expected completion",
            kind: "projection",
            before: "Not recorded",
            after: "10 seconds",
            evidence: "Estimate",
          },
        ],
        notes: ["Projected timing is not a measurement."],
        optimizations: [
          {
            key: "cache",
            title: "Cache migration",
            scope: "host",
            recorded_status: "prepared",
            detail: "Prepared during survey",
            evidence: "Report",
            current_check: {
              status: "verified",
              detail: "Current device independently measured",
            },
          },
        ],
        source_report:
          "<script>unsafeContent()</script> Original report preserved.",
        image_checks: [],
      },
    };
    snapshot.sources.docker = {
      status: "healthy",
      data: {
        containers: [],
        images: [],
        storage: {},
        worker_history: [
          {
            id: "example",
            name: "previous-ci-worker",
            image: "example:ci",
            state: "no_longer_visible",
            status: "Job outcome unknown",
            first_seen: Date.now() / 1000 - 60,
            last_seen: Date.now() / 1000,
            cpu_peak: 80,
            memory_peak: 1024,
          },
        ],
      },
    };
    await route.fulfill({ json: snapshot });
  });
  await signIn(page);
  await page
    .getByRole("button", { name: "Survey & benchmarks", exact: true })
    .click();
  await expect(
    page.getByText("Example runner survey", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("prepared", { exact: true })).toBeVisible();
  await expect(page.getByText("verified", { exact: true })).toBeVisible();
  await expect(page.getByText("4.00×", { exact: true })).toBeVisible();
  await expect(page.getByText("projection", { exact: true })).toBeVisible();
  const timing = page
    .getByRole("row")
    .filter({ hasText: "Queue + execution (derived)" });
  await expect(timing).toContainText("30s longer (25.0%)");
  const received = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download speedup report" }).click();
  const file = await received;
  const downloaded = await readFile((await file.path())!, "utf8");
  expect(downloaded).toContain("Cold-cache result");
  expect(downloaded).toContain("| #101 | Interrupted | canceled |");
  await page.getByLabel("Compare result", { exact: true }).selectOption("100");
  await expect(page.getByText("1.00×", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const downloadButton = await page
    .getByRole("button", { name: "Download speedup report" })
    .boundingBox();
  expect(downloadButton!.x + downloadButton!.width).toBeLessThanOrEqual(390);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Recorded pipeline").selectOption("1");
  await expect(
    page.getByRole("heading", { name: "Recorded jobs · #101" }),
  ).toBeVisible();
  await expect(
    page.getByText("Individual job records were not included", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByText("Read the complete original survey").click();
  await expect(page.locator(".source-report")).toContainText(
    "<script>unsafeContent()</script>",
  );
  await page.getByRole("button", { name: "Runner stack", exact: true }).click();
  await expect(
    page.getByRole("cell").filter({ hasText: "previous-ci-worker" }),
  ).toBeVisible();
  await expect(
    page.getByText("Job outcome unknown", { exact: true }),
  ).toBeVisible();
});

test("runner metrics and worker states work without GitLab integration", async ({
  page,
  request,
}) => {
  const template = await (
    await request.get("/api/snapshot", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  let available = false;
  await page.route("**/api/snapshot", async (route) => {
    const snapshot = structuredClone(template);
    snapshot.sources.gitlab = { status: "not_configured", data: null };
    snapshot.sources.services = {
      status: "healthy",
      stale: false,
      data: [
        { name: "gitlab-runner.service", state: "active", substate: "running" },
      ],
    };
    snapshot.sources.runner = {
      status: available ? "healthy" : "unavailable",
      stale: false,
      message: "Metrics listener disabled",
      data: {
        metrics: available ? { gitlab_runner_concurrent: 16 } : {},
        facts: {
          concurrent: 16,
          updated_at: 1760000000,
          runners: [
            {
              name: "build-registration",
              executor: "docker",
              limit: 0,
              request_concurrency: 4,
            },
          ],
        },
      },
    };
    snapshot.sources.docker = {
      status: "healthy",
      data: {
        ci_running: 0,
        storage: {},
        images: [
          {
            id: "sha256:" + "a".repeat(64),
            tags: ["registry.example/toolchain:cuda"],
          },
        ],
        containers: [
          {
            id: "b".repeat(64),
            name: "retained-ci-worker",
            ci: true,
            state: "exited",
            image: "sha256:" + "a".repeat(64),
          },
        ],
        worker_history: [],
        volumes: [],
      },
    };
    await route.fulfill({ json: snapshot });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Runner stack", exact: true }).click();
  const telemetry = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Runner service and metrics" }),
  });
  await expect(telemetry.getByText("active", { exact: true })).toBeVisible();
  await expect(
    telemetry.getByText("Unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    telemetry.getByText("build-registration", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("retained-ci-worker", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/No CI containers are running/)).toBeVisible();
  await page.getByLabel("Worker state", { exact: true }).selectOption("all");
  await expect(
    page.getByText("retained-ci-worker", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: /^toolchain:cuda/ }).first(),
  ).toBeVisible();
  available = true;
  await page.reload();
  await page.getByRole("button", { name: "Runner stack", exact: true }).click();
  await expect(telemetry.getByText("Available", { exact: true })).toBeVisible();
  await expect(
    telemetry.locator("strong").filter({ hasText: /^16$/ }),
  ).toBeVisible();
  await expect(telemetry.getByText(/Enable the runner/)).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("operator capacity and local archive workflows require reviewed confirmation", async ({
  page,
  request,
}) => {
  const template = await (
    await request.get("/api/snapshot", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  const id = "sha256:" + "a".repeat(64);
  template.sources.docker = {
    status: "healthy",
    data: {
      images: [{ id, tags: ["toolchain:v1"] }],
      containers: [],
      storage: {},
    },
  };
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({ json: template }),
  );
  let concurrent = 4;
  let uploaded = false;
  let jobs: any[] = [];
  await page.route("**/api/operations/capabilities", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        upload_max_bytes: 1024 ** 3,
        runner: {
          available: true,
          revision: "revision1",
          facts: {
            concurrent,
            runners: [
              { name: "build-runner", limit: 0, request_concurrency: 4 },
            ],
          },
        },
        build_profiles: [],
        uploads: uploaded
          ? [
              {
                id: "b".repeat(32),
                kind: "image",
                name: "usb-image.tar",
                bytes: 7,
                sha256: "c".repeat(64),
              },
            ]
          : [],
      },
    }),
  );
  await page.route("**/api/operations/jobs", (route) =>
    route.fulfill({ json: jobs }),
  );
  await page.route("**/api/operations/uploads?**", (route) => {
    expect(route.request().postDataBuffer()?.toString()).toBe("archive");
    uploaded = true;
    return route.fulfill({
      json: {
        id: "b".repeat(32),
        kind: "image",
        name: "usb-image.tar",
        bytes: 7,
        sha256: "c".repeat(64),
      },
    });
  });
  let action = "";
  await page.route("**/api/operations/preview", (route) => {
    const body = route.request().postDataJSON();
    action = body.action;
    return route.fulfill({
      json: {
        nonce: "review1",
        action,
        name:
          action === "runner_capacity" ? "Runner capacity" : "usb-image.tar",
        confirmation:
          action === "runner_capacity"
            ? "set workers 12"
            : "load image archive",
        expires_at: Date.now() / 1000 + 60,
        impact: "Reviewed operation",
        values: body.values,
        ...(action === "runner_capacity"
          ? {
              before: { concurrent: 4, runners: [] },
              after: { concurrent: 12, runners: [] },
            }
          : {}),
      },
    });
  });
  await page.route("**/api/operations/execute", (route) => {
    const body = route.request().postDataJSON();
    if (action === "runner_capacity") {
      expect(body.confirmation).toBe("set workers 12");
      concurrent = 12;
      return route.fulfill({ json: { message: "Worker limits saved" } });
    }
    expect(body.confirmation).toBe("load image archive");
    uploaded = false;
    jobs = [
      {
        id: "task1",
        action: "load_image",
        name: "usb-image.tar",
        status: "success",
        message: "Image loaded",
        created_at: Date.now() / 1000,
        updated_at: Date.now() / 1000,
      },
    ];
    return route.fulfill({
      json: { id: "task1", message: "Task queued; progress appears below" },
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(
    page.getByLabel("Shared job limit", { exact: true }),
  ).toHaveValue("4");
  await page.getByLabel("Shared job limit", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Review worker limits" }).click();
  await expect(
    page.getByRole("region", { name: "Operation preview" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Apply reviewed operation" }),
  ).toBeDisabled();
  await page.getByLabel("Operation confirmation").fill("set workers 12");
  await page.getByRole("button", { name: "Apply reviewed operation" }).click();
  await expect(page.getByRole("status")).toContainText("Worker limits saved");
  await page.getByLabel("Saved image archive", { exact: true }).setInputFiles({
    name: "usb-image.tar",
    mimeType: "application/x-tar",
    buffer: Buffer.from("archive"),
  });
  await expect(page.getByText("usb-image.tar", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Review image operation" }).click();
  await page.getByLabel("Operation confirmation").fill("load image archive");
  await page.getByRole("button", { name: "Apply reviewed operation" }).click();
  await expect(
    page.getByRole("cell", { name: "Image loaded", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Image operation status").selectOption("failed");
  await expect(
    page.getByText("No operations match these filters."),
  ).toBeVisible();
  await page.getByLabel("Image operation status").selectOption("all");
  await page
    .getByLabel("Image operation", { exact: true })
    .selectOption("tag_image");
  await expect(page.getByLabel("Source image", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.tmp/opsdeck-operations-mobile.png",
    fullPage: true,
  });
});

test("worker, image and audit filters narrow results and reset pagination", async ({
  page,
  request,
}) => {
  const snapshot = await (
    await request.get("/api/snapshot", {
      headers: { Authorization: `Bearer ${token}` },
    })
  ).json();
  snapshot.sources.docker = {
    status: "healthy",
    data: {
      ci_running: 24,
      storage: {},
      containers: Array.from({ length: 24 }, (_, i) => ({
        id: String(i),
        name: `ci-worker-${i}`,
        image: "toolchain:v1",
        state: "running",
        ci: true,
        ci_metadata: {
          role: i === 0 ? "predefined" : "build",
          project_id: i < 12 ? 1 : 2,
          job_id: i,
        },
      })),
      images: Array.from({ length: 24 }, (_, i) => ({
        id: `sha256:${String(i).padStart(64, "0")}`,
        tags: i === 0 ? [] : [`toolchain:v${i}`],
        created: i,
        size_bytes: i * 1000,
        referencing_containers: i === 1 ? 1 : 0,
      })),
      worker_history: [],
    },
  };
  await page.route("**/api/snapshot", (route) =>
    route.fulfill({ json: snapshot }),
  );
  await page.route("**/api/events", (route) =>
    route.fulfill({
      json: [
        {
          id: 1,
          ts: 1,
          kind: "action",
          severity: "success",
          title: "Worker limits saved",
          detail: "Applied",
        },
        {
          id: 2,
          ts: 2,
          kind: "alert",
          severity: "warning",
          title: "Storage pressure",
          detail: "Inspect disk",
        },
      ],
    }),
  );
  await signIn(page);
  await page.getByRole("button", { name: "Runner stack", exact: true }).click();
  const workers = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "CI workers and helper containers",
    }),
  });
  await expect(workers.locator("tbody tr")).toHaveCount(20);
  await workers.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(workers.locator("tbody tr")).toHaveCount(4);
  await page
    .getByLabel("Worker role", { exact: true })
    .selectOption("predefined");
  await expect(workers.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Search CI workers", { exact: true }).fill("absent");
  await expect(
    page.getByText(/No CI containers match these filters/),
  ).toBeVisible();
  await workers.getByRole("button", { name: "Reset filters" }).click();
  await expect(workers.locator("tbody tr")).toHaveCount(20);
  await page
    .getByLabel("Image usage", { exact: true })
    .selectOption("untagged");
  const images = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Pipeline and toolchain images on this host",
    }),
  });
  await expect(images.locator("tbody tr")).toHaveCount(1);
  await expect(images.getByRole("cell", { name: /^Untagged/ })).toBeVisible();
  await page
    .getByRole("button", { name: "Activity & audit", exact: true })
    .click();
  await page.getByLabel("Event kind", { exact: true }).selectOption("action");
  await expect(
    page.getByText("Worker limits saved", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Storage pressure", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByLabel("Event severity", { exact: true })
    .selectOption("critical");
  await expect(page.getByText("No events match these filters.")).toBeVisible();
});

test("repository filters, workload pagination and image drilldown share scope", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const projects = [
    { id: "3", name: "team/alpha" },
    { id: "4", name: "team/beta" },
  ];
  const image = {
    key: "sha256:alpha",
    tags: ["toolchain:alpha"],
    projects: ["3"],
    pipelines: ["3:101"],
    present: true,
  };
  await page.route("**/api/workloads?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const project = params.get("project") || "all",
      kind = params.get("kind") || "pipelines";
    const all = Array.from({ length: 25 }, (_, i) => ({
      key: `3:${101 + i}`,
      id: 101 + i,
      project_key: "3",
      project: "team/alpha",
      status: "success",
      source: "gitlab",
      outcome_known: true,
      duration: 60,
      queued_duration: 2,
      images: [image.key],
      last_seen: Date.now() / 1000,
    }));
    const rows =
      project === "4"
        ? []
        : kind === "images"
          ? [
              {
                ...image,
                id: image.key,
                size_bytes: 100,
                observed_containers: 3,
              },
            ]
          : all;
    const number = Number(params.get("page") || 1);
    await route.fulfill({
      json: {
        scope: { project, pipeline: "all", image: "all", hours: 24 },
        summary: {
          projects: project === "all" ? 2 : 1,
          running_containers: 0,
          observed_jobs: 3,
          pipelines: rows.length,
          successful_pipelines: rows.length,
          unknown_outcomes: 0,
        },
        rows: rows.slice((number - 1) * 20, number * 20),
        page: number,
        size: 20,
        total: rows.length,
        catalog: { projects, pipelines: all, images: [image] },
        worker_metadata: {},
        coverage: { gitlab_status: "healthy", note: "Test evidence" },
      },
    });
  });
  await signIn(page);
  await page
    .getByRole("button", { name: "Projects & pipelines", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "#101", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "#121", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Repository scope", { exact: true }).selectOption("4");
  await expect(
    page.getByText("No matching retained records.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Repository scope", { exact: true }).selectOption("3");
  await page.getByLabel("Workload table").selectOption("images");
  await expect(
    page.getByRole("cell", { name: /toolchain:alpha/ }).first(),
  ).toBeVisible();
  await page.getByLabel("Image scope", { exact: true }).selectOption(image.key);
  await expect(page.getByLabel("Image scope", { exact: true })).toHaveValue(
    image.key,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("real API captures, compares and exports manual survey checkpoints", async ({
  page,
}) => {
  const suffix = Date.now();
  await signIn(page);
  await page
    .getByRole("button", { name: "Survey & benchmarks", exact: true })
    .click();
  await page
    .getByLabel("Checkpoint name", { exact: true })
    .fill(`Before ${suffix}`);
  await page.getByLabel("Checkpoint notes").fill("Before workload change");
  await page
    .getByRole("button", { name: "Save current checkpoint", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    `Checkpoint saved: Before ${suffix}`,
  );
  await page
    .getByLabel("Checkpoint name", { exact: true })
    .fill(`After ${suffix}`);
  await page
    .getByRole("button", { name: "Save current checkpoint", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    `Checkpoint saved: After ${suffix}`,
  );
  const before = await page
    .getByLabel("Baseline checkpoint")
    .locator("option")
    .filter({ hasText: `Before ${suffix}` })
    .getAttribute("value");
  const after = await page
    .getByLabel("Result checkpoint")
    .locator("option")
    .filter({ hasText: `After ${suffix}` })
    .getAttribute("value");
  await page.getByLabel("Baseline checkpoint").selectOption(before!);
  await page.getByLabel("Result checkpoint").selectOption(after!);
  await page.getByRole("button", { name: "Compare saved checkpoints" }).click();
  await expect(
    page.getByRole("cell", { name: "Node CPU utilization", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/different workloads do not establish/),
  ).toBeVisible();
  await page.getByLabel("Search checkpoints").fill(`After ${suffix}`);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export checkpoint", exact: true })
    .click();
  const value = JSON.parse(
    await readFile((await (await download).path())!, "utf8"),
  );
  expect(value.title).toBe(`After ${suffix}`);
  expect(value.scope.project).toBe("all");
  expect(value.source_health).toBeDefined();
});

test("optional GitLab setup sends credentials once and clears the input", async ({
  page,
}) => {
  let saved = false;
  await page.route("**/api/integrations/gitlab", async (route) => {
    if (route.request().method() === "POST") {
      const value = route.request().postDataJSON();
      expect(value.token).toBe("fake-browser-read-only-token");
      expect(value.projects).toEqual(["team/alpha", "4"]);
      saved = true;
    }
    await route.fulfill({
      json: {
        enabled: saved,
        url: saved ? "https://gitlab.example.com" : "",
        token_configured: saved,
        projects: [],
        auto_observed: true,
        project_limit: 32,
      },
    });
  });
  await signIn(page);
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page
    .getByLabel("GitLab URL", { exact: true })
    .fill("https://gitlab.example.com");
  await page
    .getByLabel("GitLab read-only token")
    .fill("fake-browser-read-only-token");
  await page.getByLabel("GitLab project scope").fill("team/alpha\n4");
  await page
    .getByRole("button", { name: "Save and validate read-only connection" })
    .click();
  await expect(page.getByText(/Read-only connection saved/)).toBeVisible();
  await expect(page.getByLabel("GitLab read-only token")).toHaveValue("");
  expect(saved).toBe(true);
});
test("theme choice applies dark tokens, persists, and returns to system", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page);
  const background = () =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await page.getByRole("radio", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await background()).not.toBe(light);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Dark theme" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("radio", { name: "Match system theme" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
  expect(await background()).toBe(light);
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await background()).not.toBe(light);
});

test("fleet retains the complete host sidebar and scopes every original page to the selected host", async ({
  page,
  request,
}) => {
  const auth = { Authorization: `Bearer ${token}` };
  const snapshot = await (
    await request.get("/api/snapshot", { headers: auth })
  ).json();
  const nodes = ["a", "b"].map((id) => ({
    id: `workspace-${id}`,
    name: `runner-${id}`,
    cluster: `cluster-${id}`,
    hostname: `host-${id}`,
    status: "online",
    metrics: {},
    source_status: {},
  }));
  const seen: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/healthz", (route) =>
    route.fulfill({ json: { status: "ok", mode: "central" } }),
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/fleet" || url.pathname === "/api/snapshot") {
      return route.fulfill({ json: { nodes, retention_days: 30 } });
    }
    const node = nodes.find((node) =>
      url.pathname.startsWith(`/api/fleet/nodes/${node.id}`),
    );
    if (node && url.pathname.includes("/workspace/")) {
      seen.push(url.pathname);
      const path = url.pathname.split("/workspace/")[1];
      if (path === "snapshot") {
        const copy = structuredClone(snapshot);
        if (copy.sources.host.data)
          copy.sources.host.data.hostname = node.hostname;
        return route.fulfill({ json: copy });
      }
      const response = await request.get(`/api/${path}${url.search}`, {
        headers: auth,
      });
      return route.fulfill({ response });
    }
    if (node)
      return route.fulfill({
        json: url.pathname.endsWith("/history")
          ? []
          : { node, sources: snapshot.sources, workspace_connected: true },
      });
    throw new Error(`Unexpected unscoped API request: ${url.pathname}`);
  });
  await page.goto("/");
  await page.getByLabel("Access token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  const sections = [
    "Overview",
    "Host & hardware",
    "Docker",
    "Runner stack",
    "Projects & pipelines",
    "Survey & benchmarks",
    "Optimization",
    "Operations",
    "Activity & audit",
    "Connections",
  ];
  for (const name of sections)
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Docker", exact: true }).click();
  await expect(page.getByText("Select a host to open Docker.")).toBeVisible();
  const picker = page.getByRole("combobox", { name: "Switch host" });
  await picker.selectOption(nodes[0].id);
  await expect(
    page.getByRole("heading", { name: "Docker", exact: true }),
  ).toBeVisible();
  for (const name of sections) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await picker.selectOption(nodes[1].id);
  await expect(
    page.getByRole("heading", { name: "Connections", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".host-chip")).toContainText(nodes[1].hostname);
  expect(
    seen.some((path) =>
      path.includes(`${nodes[0].id}/workspace/operations/capabilities`),
    ),
  ).toBe(true);
  expect(
    seen.some((path) => path.includes(`${nodes[1].id}/workspace/snapshot`)),
  ).toBe(true);
  await page.goto(`/?node=${nodes[1].id}&section=invalid-section`);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("CPU utilization", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Agent access", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Agent access", exact: true }),
  ).toBeVisible();
  await picker.selectOption("");
  await expect(
    page.getByRole("heading", { name: "Your runner fleet", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.selectOption(nodes[0].id);
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.tmp/fleet-sidebar-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("radio", { name: "Dark theme" }).click();
  await page.screenshot({
    path: "../.tmp/fleet-sidebar-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("GitLab setup waits for saved settings before allowing edits", async ({
  page,
}) => {
  let release!: () => void;
  const loaded = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested = false;
  let saves = 0;
  let reads = 0;
  await page.route("**/api/integrations/gitlab", async (route) => {
    if (route.request().method() === "GET") {
      requested = true;
      if (++reads === 1) {
        await loaded;
        await route.fulfill({
          status: 503,
          json: { detail: "Temporary settings failure" },
        });
        return;
      }
      await route.fulfill({
        json: {
          enabled: false,
          url: "",
          token_configured: false,
          projects: [],
          auto_observed: true,
          project_limit: 32,
        },
      });
    } else {
      saves++;
      const values = route.request().postDataJSON();
      expect(values.url).toBe("https://gitlab.example.com");
      expect(values.projects).toEqual(["team/alpha"]);
      await route.fulfill({
        json: {
          enabled: true,
          url: values.url,
          token_configured: true,
          projects: values.projects,
          auto_observed: true,
          project_limit: 32,
        },
      });
    }
  });
  try {
    await signIn(page);
    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await expect.poll(() => requested).toBe(true);
    await expect(page.getByLabel("GitLab URL", { exact: true })).toBeDisabled();
    release();
    await expect(page.getByText("Temporary settings failure")).toBeVisible();
    await page
      .getByRole("button", { name: "Retry loading GitLab settings" })
      .click();
    await page
      .getByLabel("GitLab URL", { exact: true })
      .fill("https://gitlab.example.com");
    await page
      .getByLabel("GitLab read-only token")
      .fill("fake-regression-read-only-token");
    await page.getByLabel("GitLab project scope").fill("team/alpha");
    await page
      .getByRole("button", { name: "Save and validate read-only connection" })
      .click();
    await expect(page.getByText(/Read-only connection saved/)).toBeVisible();
    await expect(page.getByLabel("GitLab URL", { exact: true })).toHaveValue(
      "https://gitlab.example.com",
    );
    await expect(page.getByLabel("GitLab read-only token")).toHaveValue("");
    expect(saves).toBe(1);
  } finally {
    release();
  }
});

test("all-hosts navigation keeps clusters and footer reachable without nested clipping", async ({
  page,
}) => {
  const downloaded: string[] = [];
  page.on("request", (request) =>
    downloaded.push(new URL(request.url()).pathname),
  );
  const nodes = Array.from({ length: 24 }, (_, index) => ({
    id: `layout-${index}`,
    name: `runner-${index}`,
    hostname: `host-${index}`,
    cluster: `network-${String(index).padStart(2, "0")}`,
    status: "online",
    metrics: {},
    source_status: {},
  }));
  await page.route("**/healthz", (route) =>
    route.fulfill({ json: { status: "ok", mode: "central" } }),
  );
  await page.route("**/api/**", (route) =>
    route.fulfill({ json: { nodes, retention_days: 30 } }),
  );
  await page.goto("/");
  await page.getByLabel("Access token", { exact: true }).fill(token);
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  await expect(
    page
      .getByRole("combobox", { name: "Switch host" })
      .getByRole("option", { name: /runner-23/ }),
  ).toHaveCount(1);
  expect(
    downloaded.filter((path) =>
      /\/(HostWorkspace-|NodeDetail-|charts-)/.test(path),
    ),
  ).toEqual([]);
  const sidebar = page.getByRole("complementary");
  for (const height of [960, 768, 600]) {
    await page.setViewportSize({ width: 1853, height });
    await expect
      .poll(() =>
        sidebar.evaluate(
          (element) => element.scrollHeight <= element.clientHeight + 1,
        ),
      )
      .toBe(true);
    const signOut = sidebar.getByRole("button", {
      name: "Sign out",
      exact: true,
    });
    const footerBox = await signOut.boundingBox();
    expect(footerBox!.y + footerBox!.height).toBeLessThanOrEqual(height);
    const cluster = sidebar.getByRole("button", { name: /network-23/ });
    await cluster.scrollIntoViewIfNeeded();
    const box = await cluster.boundingBox();
    expect(box!.height).toBeGreaterThan(30);
    expect(box!.y + box!.height).toBeLessThan(footerBox!.y);
    await sidebar
      .getByRole("button", { name: "Connections", exact: true })
      .scrollIntoViewIfNeeded();
  }
  await page.setViewportSize({ width: 1853, height: 960 });
  await page.getByRole("radio", { name: "Dark theme" }).click();
  await page.screenshot({ path: "../.tmp/all-hosts-layout-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../.tmp/all-hosts-layout-mobile.png" });
});

test("a failed workspace chunk offers a reload instead of a blank page", async ({
  page,
}) => {
  const chunk = "**/assets/HostWorkspace-*.js";
  await page.route(chunk, (route) => route.abort());
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Workspace could not load" }),
  ).toBeVisible();
  await page.unroute(chunk);
  await page.getByRole("button", { name: "Reload workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Connect to OpsDeck" }),
  ).toBeVisible();
});
