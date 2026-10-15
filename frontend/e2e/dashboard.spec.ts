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
    page.getByText("not configured", { exact: false }).first(),
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
            first_seen: 1,
            last_seen: 2,
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
