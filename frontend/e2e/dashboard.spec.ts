import { expect, test } from "@playwright/test";
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
    "Pipelines & runners",
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
