import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const operator = "fleet-browser-test-token-at-least-32-characters";
test("header switches across clusters, restores host URLs, and returns to all hosts", async ({
  page,
  request,
}) => {
  const suffix = randomUUID().slice(0, 8);
  const headers = { Authorization: `Bearer ${operator}` };
  async function createHost(
    name: string,
    cluster: string,
    cpu: number,
    stale = false,
  ) {
    const enrollment = await request.post("/api/fleet/nodes", {
      headers,
      data: { name: `${name}-${suffix}`, cluster: `${cluster}-${suffix}` },
    });
    expect(enrollment.status()).toBe(200);
    const node = await enrollment.json();
    const stamp = Date.now() / 1000 - (stale ? 300 : 0);
    const values = {
      host: {
        hostname: name,
        scope: "native",
        cpu: { percent: cpu },
        memory: { percent: cpu },
      },
      docker: {},
      gpu: [],
      runner: {},
      services: [],
    };
    expect(
      (
        await request.post("/api/agent/telemetry", {
          headers: { Authorization: `Bearer ${node.token}` },
          data: {
            schema_version: 1,
            sample_id: randomUUID(),
            collected_at: stamp,
            sources: Object.fromEntries(
              Object.entries(values).map(([key, data]) => [
                key,
                { status: "healthy", updated_at: stamp, data },
              ]),
            ),
          },
        })
      ).status(),
    ).toBe(200);
    return node;
  }
  const a = await createHost("switch-a", "network-a", 17);
  const b = await createHost("switch-b", "network-b", 83, true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Access token", { exact: true }).fill(operator);
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  const picker = page.getByRole("combobox", { name: "Switch host" });
  await expect(picker).toHaveValue("");
  await expect(picker.locator(`optgroup[label="${a.cluster}"]`)).toHaveCount(1);
  await expect(
    picker.getByRole("option", { name: new RegExp(b.name) }),
  ).toHaveText(/stale/);
  await page.getByRole("button", { name: a.cluster, exact: false }).click();
  await picker.selectOption(a.id);
  await expect(
    page.getByRole("heading", { name: a.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".fleet-capacity")).toContainText("17.0%");
  await picker.selectOption(b.id);
  await expect(
    page.getByRole("heading", { name: b.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".fleet-capacity")).toContainText("83.0%");
  await expect(page.locator(".fleet-capacity")).not.toContainText("17.0%");
  await expect(page).toHaveURL(new RegExp(`node=${b.id}`));
  await page.reload();
  await expect(picker).toHaveValue(b.id);
  await expect(
    page.getByRole("heading", { name: b.name, exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(picker).toHaveValue(a.id);
  await expect(
    page.getByRole("heading", { name: a.name, exact: true }),
  ).toBeVisible();
  await picker.selectOption("");
  await expect(
    page.getByRole("heading", { name: "Your runner fleet", exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/node=/);
  await page.getByLabel("Search hosts").fill("does-not-match");
  await page
    .getByRole("button", { name: "Activity & audit", exact: true })
    .click();
  await picker.selectOption(b.id);
  await expect(
    page.getByRole("heading", { name: b.name, exact: true }),
  ).toBeVisible();
  await picker.selectOption("");
  await expect(page.getByLabel("Search hosts")).toHaveValue("");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(picker).toBeVisible();
  await picker.selectOption(a.id);
  await expect(
    page.getByRole("heading", { name: a.name, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.tmp/host-switcher-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("radio", { name: "Dark theme" }).click();
  await page.screenshot({
    path: "../.tmp/host-switcher-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("enroll, ingest, filter, drill down, rotate, and revoke through the real API", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const name = `runner-${randomUUID().slice(0, 8)}`;
  const cluster = `network-${randomUUID().slice(0, 8)}`;
  await page.goto("/");
  await page.getByLabel("Access token", { exact: true }).fill(operator);
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  await expect(
    page.getByRole("heading", { name: "Your runner fleet" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enroll host", exact: true })
    .first()
    .click();
  await page.getByLabel("Host name", { exact: true }).fill(name);
  await page.getByLabel("Cluster or network").fill(cluster);
  await page.getByRole("button", { name: "Create agent credential" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  const config = await modal.locator("pre").first().textContent();
  const token = config!.split("OPSDECK_AGENT_TOKEN=")[1].trim();
  expect(token.length).toBeGreaterThan(64);
  const id = token.split(".")[0];
  const stamp = Date.now() / 1000;
  const values = {
    host: {
      hostname: "build.local",
      scope: "native",
      cpu: { percent: 37, cores: 4, threads: 8 },
      memory: { percent: 52, used: 8 * 1024 ** 3, total: 16 * 1024 ** 3 },
      volumes: [
        {
          mount: "/",
          device: "/dev/sda1",
          used: 1024,
          total: 2048,
          percent: 50,
        },
      ],
      network: [],
      disks: [],
    },
    docker: {
      ci_running: 3,
      containers: [
        {
          name: "ci-job-123",
          image: "compiler:v1",
          state: "running",
          cpu_percent: 15,
          memory_bytes: 1024,
          ci_metadata: { job_id: "123" },
        },
      ],
      images: [],
    },
    gpu: [],
    runner: { facts: { concurrent: 4 }, metrics: { gitlab_runner_jobs: 3 } },
    services: [
      { name: "gitlab-runner.service", state: "active", substate: "running" },
    ],
  };
  const response = await request.post("/api/agent/telemetry", {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      schema_version: 1,
      sample_id: randomUUID(),
      collected_at: stamp,
      sources: Object.fromEntries(
        Object.entries(values).map(([key, data]) => [
          key,
          { status: "healthy", data, updated_at: stamp },
        ]),
      ),
    },
  });
  expect(response.status()).toBe(200);
  await page.getByRole("button", { name: "Saved, view host" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("37.0%", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Containers", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "ci-job-123", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Runner & services", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "gitlab-runner.service", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "active", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Confirm host name").fill(name);
  await page.getByRole("button", { name: "Rotate credential" }).click();
  await expect(modal).toBeVisible();
  const rotatedConfig = await modal.locator("pre").first().textContent();
  const rotated = rotatedConfig!.split("OPSDECK_AGENT_TOKEN=")[1].trim();
  expect(rotated).not.toBe(token);
  expect(
    (
      await request.post("/api/agent/telemetry", {
        headers: { Authorization: `Bearer ${token}` },
        data: {},
      })
    ).status(),
  ).toBe(401);
  await page.getByRole("button", { name: "Saved, view host" }).click();
  await page.getByLabel("Confirm host name").fill(name);
  await page.getByRole("button", { name: "Revoke agent" }).click();
  await expect(
    page.getByText(
      "This agent is revoked. Rotate its credential to reconnect it.",
    ),
  ).toBeVisible();
  expect(
    (
      await request.get(`/api/fleet/nodes/${id}`, {
        headers: { Authorization: `Bearer ${operator}` },
      })
    ).status(),
  ).toBe(200);
  await page.getByRole("button", { name: "Back to hosts" }).click();
  await page.getByLabel("Search hosts").fill(name);
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "All clusters", exact: false })
    .click();
  await page.screenshot({ path: "../.tmp/fleet-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Cluster filter").selectOption(cluster);
  await expect(
    page.getByRole("heading", { name: cluster, exact: true }),
  ).toBeVisible();
  await page.getByLabel("Cluster filter").selectOption("");
  await expect(
    page.getByRole("heading", { name: "Your runner fleet" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "../.tmp/fleet-mobile.png", fullPage: true });
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Enroll host", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Enroll a runner host" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Access token", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
