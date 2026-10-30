import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const operator = "fleet-browser-test-token-at-least-32-characters";
test("image copy review, policy repair and durable transfer history work in a host workspace", async ({
  page,
  request,
}) => {
  const headers = { Authorization: `Bearer ${operator}` };
  const suffix = randomUUID().slice(0, 8);
  const source = await (
    await request.post("/api/fleet/nodes", {
      headers,
      data: { name: `image-source-${suffix}`, cluster: "Image tests" },
    })
  ).json();
  const target = await (
    await request.post("/api/fleet/nodes", {
      headers,
      data: { name: `image-target-${suffix}`, cluster: "Image tests" },
    })
  ).json();
  const facts = {
    concurrent: 1,
    runners: [
      {
        name: "mac-runner",
        executor: "docker",
        limit: 0,
        request_concurrency: 1,
        pull_policy: "always",
      },
    ],
  };
  const snapshot = {
    version: "test",
    sources: {
      host: {
        status: "healthy",
        data: {
          hostname: target.name,
          cpu: { percent: 1 },
          memory: { percent: 1 },
          scope: "native",
        },
      },
      docker: {
        status: "healthy",
        data: { images: [], containers: [], storage: {} },
      },
    },
    alerts: [],
    recommendations: [],
    server_time: Date.now() / 1000,
    sample_seconds: 10,
    retention_days: 30,
    actions_enabled: false,
    history_error: null,
  };
  let transfers: any[] = [];
  const ready = {
    reference: "toolchain:v1",
    present: false,
    architecture: "amd64",
    engine_architecture: "aarch64",
    staging_free: 20 * 1024 ** 3,
    engine_disk_free: null,
    runner: { available: true, revision: "policy-rev", facts },
  };
  await page.route(`**/api/fleet/nodes/${target.id}`, (route) =>
    route.fulfill({
      json: {
        node: { ...target, status: "online" },
        sources: {},
        workspace_connected: true,
      },
    }),
  );
  await page.route(
    `**/api/fleet/nodes/${source.id}/workspace/snapshot`,
    (route) =>
      route.fulfill({
        json: {
          sources: {
            docker: { data: { images: [{ tags: ["toolchain:v1"] }] } },
          },
        },
      }),
  );
  await page.route(`**/api/fleet/nodes/${target.id}/workspace/**`, (route) => {
    const path = new URL(route.request().url()).pathname.split(
      "/workspace/",
    )[1];
    if (path === "snapshot") return route.fulfill({ json: snapshot });
    if (path === "operations/capabilities")
      return route.fulfill({
        json: {
          enabled: true,
          upload_max_bytes: 32 * 1024 ** 3,
          runner: ready.runner,
          build_profiles: [],
          uploads: [],
        },
      });
    if (path === "operations/readiness") return route.fulfill({ json: ready });
    if (path === "operations/preview") {
      expect(route.request().postDataJSON()).toEqual({
        action: "runner_image_policy",
        values: {
          runner: "mac-runner",
          pull_policy: "if-not-present",
          revision: "policy-rev",
        },
      });
      return route.fulfill({
        json: {
          action: "runner_image_policy",
          nonce: "policy-review",
          name: "Runner image policy",
          confirmation: "set image policy mac-runner if-not-present",
          expires_at: Date.now() / 1000 + 60,
          impact: "Backs up and changes image policy",
          before: facts,
          after: {
            ...facts,
            runners: [{ ...facts.runners[0], pull_policy: "if-not-present" }],
          },
          values: {},
        },
      });
    }
    if (path === "operations/execute") {
      expect(route.request().postDataJSON().confirmation).toBe(
        "set image policy mac-runner if-not-present",
      );
      return route.fulfill({ json: { message: "Image policy saved" } });
    }
    if (path === "workloads")
      return route.fulfill({
        json: {
          scope: {},
          catalog: { projects: [], pipelines: [], images: [] },
          rows: [],
          worker_metadata: {},
          summary: {},
        },
      });
    return route.fulfill({ json: [] });
  });
  await page.route("**/api/fleet/image-transfers?**", (route) =>
    route.fulfill({ json: transfers }),
  );
  await page.route("**/api/fleet/image-transfers/preview", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      source: source.id,
      destination: target.id,
      reference: "toolchain:v1",
      allow_emulation: true,
    });
    return route.fulfill({
      json: {
        nonce: "copy-review",
        expires_at: Date.now() / 1000 + 60,
        confirmation: "copy toolchain:v1",
        source_name: source.name,
        destination_name: target.name,
        reference: "toolchain:v1",
        estimated_bytes: 8192,
        architecture: "amd64",
        source_info: ready,
        destination_info: ready,
      },
    });
  });
  await page.route("**/api/fleet/image-transfers/execute", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      nonce: "copy-review",
      confirmation: "copy toolchain:v1",
    });
    transfers = [
      {
        id: "a".repeat(32),
        source: source.id,
        destination: target.id,
        source_name: source.name,
        destination_name: target.name,
        reference: "toolchain:v1",
        status: "running",
        stage: "copying",
        message: "Copying archive to destination",
        offset: 4096,
        total: 8192,
      },
    ];
    return route.fulfill({ json: transfers[0] });
  });
  await page.addInitScript(
    (value) => sessionStorage.setItem("opsdeck.token", value),
    operator,
  );
  await page.goto(`/?node=${target.id}&section=operations`);
  await page.getByLabel("Required image tag").fill("toolchain:v1");
  await page.getByRole("button", { name: "Check runner readiness" }).click();
  await expect(
    page.getByText("Image is missing from this Docker engine"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review image policy" }).click();
  await page
    .getByLabel("Operation confirmation")
    .fill("set image policy mac-runner if-not-present");
  await page.getByRole("button", { name: "Apply reviewed operation" }).click();
  await expect(
    page.getByText("Image policy saved", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Source image host").selectOption(source.id);
  await page
    .getByLabel("Allow a different CPU architecture", { exact: false })
    .check();
  await page.getByRole("button", { name: "Review image copy" }).click();
  await expect(
    page.getByRole("button", { name: "Start image copy" }),
  ).toBeDisabled();
  await page.getByLabel("Image copy confirmation").fill("copy toolchain:v1");
  await page.getByRole("button", { name: "Start image copy" }).click();
  await expect(page.getByLabel("Image transfer history")).toContainText(
    "Copy archive · running",
  );
  await page.reload();
  await expect(page.getByLabel("Image transfer history")).toContainText(
    "Copy archive · running",
  );
  await page.screenshot({
    path: "../.tmp/opsdeck-image-repair-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../.tmp/opsdeck-image-repair-mobile.png",
    fullPage: true,
  });
});
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
    page.getByRole("heading", { name: "Runner fleet", exact: true }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/node=/);
  await page.getByLabel("Search hosts").fill("does-not-match");
  await page.getByRole("button", { name: "Fleet audit", exact: true }).click();
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
    page.getByRole("heading", { name: "Runner fleet" }),
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
  await page.getByRole("tab", { name: "Containers", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "ci-job-123", exact: true }),
  ).toBeVisible();
  const runnerTab = page.getByRole("tab", {
    name: "Runner & services",
    exact: true,
  });
  await runnerTab.click();
  await expect(runnerTab).toHaveAttribute("aria-selected", "true");
  await runnerTab.press("ArrowLeft");
  await expect(
    page.getByRole("tab", { name: "Containers", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(runnerTab).toBeFocused();
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
    page.getByRole("heading", { name: "Runner fleet" }),
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

test("command center shows summary, pulse, alerts, maintenance, and the palette", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const suffix = randomUUID().slice(0, 8);
  const headers = { Authorization: `Bearer ${operator}` };
  const enrollment = await request.post("/api/fleet/nodes", {
    headers,
    data: { name: `hot-${suffix}`, cluster: `pulse-${suffix}` },
  });
  expect(enrollment.status()).toBe(200);
  const hot = await enrollment.json();
  const stamp = Date.now() / 1000;
  const values = {
    host: {
      hostname: `hot-${suffix}.local`,
      scope: "native",
      cpu: { percent: 95 },
      memory: { percent: 40 },
    },
    docker: { ci_running: 2 },
    gpu: [],
    runner: {},
    services: [],
  };
  expect(
    (
      await request.post("/api/agent/telemetry", {
        headers: { Authorization: `Bearer ${hot.token}` },
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
  await page.goto("/");
  await page.getByLabel("Access token", { exact: true }).fill(operator);
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  await expect(
    page.getByRole("heading", { name: "Runner fleet", exact: true }),
  ).toBeVisible();
  const summary = page.getByRole("region", { name: "Fleet summary" });
  await expect(summary).toContainText("Hosts online");
  await expect(summary).toContainText("Average CPU");
  await expect(summary).toContainText("Open alerts");
  await page.getByLabel("Search hosts").fill(hot.name);
  const pulseRow = page.getByRole("button", {
    name: new RegExp(`^${hot.name}, CPU now 95%`),
  });
  await expect(pulseRow).toBeVisible();
  await expect(pulseRow).toHaveAccessibleName(/peak 95% in the last hour$/);
  const attention = page.getByRole("region", { name: "Needs attention" });
  const hotAlert = attention.getByRole("button", {
    name: new RegExp(hot.name),
  });
  await expect(hotAlert.first()).toBeVisible();
  await expect(hotAlert.first()).toContainText("Critical");
  await page.getByLabel("Search hosts").fill("");
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type(`Open ${hot.name}`);
  await page.keyboard.press("Enter");
  await expect(palette).toBeHidden();
  await expect(
    page.getByRole("heading", { name: hot.name, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`node=${hot.id}`));
  await expect(page.getByRole("list", { name: "Host alerts" })).toBeVisible();
  await page.getByRole("switch", { name: /Maintenance mode/ }).check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved.")).toBeVisible();
  await expect(page.getByText("This host is in maintenance.")).toBeVisible();
  await page.getByRole("button", { name: "Back to hosts" }).click();
  await page.getByLabel("Search hosts").fill(hot.name);
  await expect(attention).toContainText("All hosts within thresholds");
  await expect(attention).not.toContainText(hot.name);
  await expect(page.locator(".host-card", { hasText: hot.name })).toContainText(
    "maintenance",
  );
  expect(errors).toEqual([]);
});

test("administrator signs in with a password and signs out", async ({
  page,
}) => {
  await page.route("**/api/auth/config", (route) =>
    route.fulfill({ json: { mode: "password" } }),
  );
  await page.route("**/api/auth/login", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.username).toBe("admin");
    await route.fulfill(
      body.password === "correct-password-for-browser-test"
        ? { json: { token: operator } }
        : {
            status: 401,
            json: { detail: "Username or password was not accepted" },
          },
    );
  });
  await page.goto("/");
  await page.getByLabel("Username", { exact: true }).fill("admin");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Username or password was not accepted",
  );
  await page
    .getByLabel("Password", { exact: true })
    .fill("correct-password-for-browser-test");
  await page.getByRole("button", { name: "Connect to OpsDeck" }).click();
  await expect(
    page.getByRole("combobox", { name: "Switch host" }),
  ).toBeVisible();
  const logout = page.waitForRequest("**/api/auth/logout");
  await page
    .getByRole("button", { name: "Sign out", exact: true })
    .first()
    .click();
  await logout;
  await expect(page.getByLabel("Username", { exact: true })).toBeVisible();
});
