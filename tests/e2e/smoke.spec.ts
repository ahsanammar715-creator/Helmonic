import { test, expect } from "@playwright/test";

const routes = [
  "/",
  "/consult",
  "/consult/new",
  "/consult/report",
  "/build",
  "/build/new",
  "/build/bom",
  "/logistics",
  "/growth/marketing",
  "/growth/leads",
  "/growth/tenders",
];

test.describe("route smoke test", () => {
  for (const route of routes) {
    test(`${route} loads without console/page errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });

      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status()).toBeLessThan(400);
      expect(errors).toEqual([]);
    });
  }
});

test.describe("Phase 1A runtime safeguards", () => {
  test("health is process-only while readiness fails closed without Azure configuration", async ({ request }) => {
    const response = await request.get("/healthz");
    expect(response.status()).toBe(200);
    const health = await response.json();
    expect(health).toMatchObject({
      status: "healthy",
      service: "helmonic-consult",
    });
    expect(health.runtime).toHaveProperty("userId");
    expect(health.runtime).toHaveProperty("nonRoot");
    expect([null, true]).toContain(health.runtime.nonRoot);

    const readiness = await request.get("/readyz");
    expect(readiness.status()).toBe(503);
    await expect(readiness.json()).resolves.toMatchObject({ status: "not-ready" });
  });

  test("Consult is inert and explicit when HELMONIC_RUNTIME is unset", async ({ page }) => {
    await page.goto("/consult");
    const composer = page.getByPlaceholder("Ask Helmonic about the 16 source documents…");
    await composer.fill("What do the permitted sources say?");
    await composer.press("Enter");

    await expect(page.getByText("Runtime not configured")).toBeVisible();
    await expect(
      page.getByText("The Azure Consult runtime is not configured in this deployment."),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Sources from the 16-document knowledge set will appear here after a successful query.",
      ),
    ).toBeVisible();
  });

  test("Consult API short-circuits without attempting Azure", async ({ request }) => {
    const response = await request.post("/api/consult/query", {
      data: { question: "What do the permitted sources say?" },
    });
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      answer: null,
      citations: [],
      mode: "not-configured",
    });
  });
});

test.describe("key interactive flows", () => {
  test("landing: prompt bar opens the workspace chooser and routes to Consult", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder(/Check this result against|Draft a Section 4|Size a Dolby|Create a bill/).fill(
      "Draft a Section 4 report"
    );
    await page.getByText("Try a prompt").click();
    await expect(page.getByText("Where should Helmonic use this prompt?")).toBeVisible();
    await page.getByText("Consult · iAcoustics").click();
    await expect(page).toHaveURL(/\/consult\/new$/);
  });

  test("landing: Try a prompt still works with nothing typed (uses the shown example)", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Try a prompt").click();
    await expect(page.getByText("Where should Helmonic use this prompt?")).toBeVisible();
  });

  test("landing: Founders' Vision opens and closes the modal", async ({ page }) => {
    await page.goto("/");
    await page.getByText(/Founders.{1,2}Vision/).first().click();
    await expect(page.getByText("Helmonic exists because")).toBeVisible();
    await expect(page.getByAltText("Jim Dunne, Founder")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByText("Helmonic exists because")).toBeHidden();
  });

  test("landing: Sign in opens a form with a Google option", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Sign in", { exact: true }).click();
    await expect(page.getByText("Sign in to Helmonic")).toBeVisible();
    await expect(page.getByPlaceholder("you@iacoustics.com")).toBeVisible();
    await expect(page.getByText("Continue with Google")).toBeVisible();
    await page.getByRole("button", { name: "Close sign-in" }).click();
    await expect(page.getByText("Sign in to Helmonic")).toBeHidden();
  });

  test("landing: Founder articles popover opens an article", async ({ page }) => {
    await page.goto("/");
    await page.getByText("Founder articles").click();
    await expect(page.getByText("Acoustics is the art of shaping calm")).toBeVisible();
    await page.getByText("Acoustics is the art of shaping calm").click();
    await expect(page.getByText("This article is a placeholder")).toBeVisible();
    await page.getByRole("button", { name: "Close article" }).click();
    await expect(page.getByText("This article is a placeholder")).toBeHidden();
  });

  test("consult: new-project conversation runs start to review", async ({ page }) => {
    await page.goto("/consult/new");
    await page.getByText("Use client criteria instead").click();
    await expect(page.getByText("Site type")).toBeVisible();

    const composer = page.getByPlaceholder("Answer, or ask why a position was flagged…");
    await composer.fill("Commercial fit-out, airborne only. Draft the report.");
    await composer.press("Enter");

    await expect(page.getByText("Targets met · 2 of 3 rooms")).toBeVisible();
    await page.getByText("Create project & draft report").click();
    await expect(page).toHaveURL(/\/consult\/report$/);
    await expect(page.getByText("Airborne sound insulation assessment")).toBeVisible();
  });

  test("build: cost estimator completes and exports a BOM", async ({ page }) => {
    await page.goto("/build/new");
    const composer = page.getByPlaceholder("Answer here, or describe the room in your own words…");
    await composer.fill("32.4 m2, two extra rooms");
    await composer.press("Enter");

    await expect(page.getByText("Spec is complete.")).toBeVisible();
    await page.getByRole("button", { name: "Export BOM" }).click();
    await expect(page.getByText("Export bill of materials")).toBeVisible();
    await page.getByText("Download CSV").click();
    await expect(page.getByText(/BOM generated/)).toBeVisible();
  });

  test("growth: exactly Marketing, Lead Generation and Tender Intelligence tabs exist", async ({ page }) => {
    await page.goto("/growth/marketing");
    await expect(page.getByRole("link", { name: "Marketing" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Lead Generation" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tender Intelligence" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Planning" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Consult" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Build" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Logistics" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Growth" })).toBeVisible();
  });

  test("growth: lead generation research reveals the ranked list and company panel", async ({ page }) => {
    await page.goto("/growth/leads");
    await page.getByText("Research Berlin").click();
    await expect(page.getByText("Berlin research complete.")).toBeVisible({ timeout: 5000 });
    await page.getByText("Example Post GmbH").click();
    await expect(page.getByText("Prepare outreach")).toBeVisible();
  });

  test("growth: lead generation switches between Smart Studio and iAcoustics Planning Signals", async ({ page }) => {
    await page.goto("/growth/leads");
    await expect(page.getByText("Find the companies worth approaching.")).toBeVisible();

    await page.getByRole("button", { name: "iAcoustics" }).click();
    await expect(page.getByText("Find projects that are starting to need acoustic expertise.")).toBeVisible();

    await page.getByRole("button", { name: "Smart Studio" }).click();
    await expect(page.getByText("Find the companies worth approaching.")).toBeVisible();
  });

  test("growth: Planning Signals scans, lists results, and separates source facts from analysis", async ({ page }) => {
    await page.goto("/growth/leads");
    await page.getByRole("button", { name: "iAcoustics" }).click();

    await page.getByText("Scan Irish planning projects for acoustic RFIs").click();
    await expect(page.getByText("Scanning Irish planning activity…")).toBeVisible();
    await expect(page.getByText("Scan complete.")).toBeVisible({ timeout: 5000 });

    await expect(page.getByText("Blackrock Health & Wellness Hub")).toBeVisible();
    await page.getByText("Blackrock Health & Wellness Hub").click();

    await expect(page.getByText("ACOUSTIC TRIGGER")).toBeVisible();
    await expect(page.getByText("SOURCE EVIDENCE")).toBeVisible();
    await expect(page.getByText("PARTIES INVOLVED", { exact: true })).toBeVisible();
    await expect(page.getByText("Helmonic analysis ·", { exact: false })).toBeVisible();

    await page.getByRole("button", { name: "Review opportunity" }).click();
    await expect(page.getByRole("button", { name: "Under review" })).toBeDisabled();
  });

  test("growth: Tender Intelligence tab is reachable from Marketing and Leads", async ({ page }) => {
    await page.goto("/growth/marketing");
    await page.getByRole("link", { name: "Tender Intelligence" }).click();
    await expect(page).toHaveURL(/\/growth\/tenders$/);
    await expect(page.getByText("Find the Irish tenders worth pursuing.")).toBeVisible();
  });

  test("growth: Tender Intelligence communicates Ireland-wide, multi-source coverage", async ({ page }) => {
    await page.goto("/growth/tenders");
    await expect(page.getByText("IACOUSTICS · IRELAND-WIDE")).toBeVisible();
    await expect(page.getByText(/eTenders, TED, local authorities and public bodies/)).toBeVisible();

    await page.getByText("Scan Irish acoustic consultancy tenders").click();
    await expect(page.getByText("Scan complete.")).toBeVisible({ timeout: 5000 });

    await expect(page.getByText("SOURCE", { exact: true })).toBeVisible();
    await expect(page.getByText("OPW", { exact: true })).toBeVisible();
    await expect(page.getByText("Local Authority").first()).toBeVisible();
  });

  test("growth: Tender Intelligence scans, lists results, and opens the intelligence panel", async ({ page }) => {
    await page.goto("/growth/tenders");
    await expect(page.getByText("Find the Irish tenders worth pursuing.")).toBeVisible();

    await page.getByText("Scan Irish acoustic consultancy tenders").click();
    await expect(page.getByText("Scanning Irish tender sources…")).toBeVisible();
    await expect(page.getByText("Scan complete.")).toBeVisible({ timeout: 5000 });

    await expect(page.getByText("Environmental Noise Impact Assessment", { exact: false })).toBeVisible();
    await page.getByText("Environmental Noise Impact Assessment", { exact: false }).first().click();

    await expect(page.getByText("WHY IT FITS")).toBeVisible();
    await expect(page.getByText("MANDATORY REQUIREMENTS")).toBeVisible();
    await expect(page.getByText("SOURCE EVIDENCE")).toBeVisible();
    await expect(page.getByText("Helmonic analysis ·", { exact: false })).toBeVisible();

    await page.getByRole("link", { name: "Send to Consult" }).click();
    await expect(page).toHaveURL(/\/consult\/new$/);
  });

  test("mobile: sidebar collapses to a bottom tab bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/consult");
    await expect(page.getByRole("link", { name: "Consult" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Build" })).toBeVisible();
  });

  test("mobile: Tender Intelligence renders with the Growth sub-nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/growth/tenders");
    await expect(page.getByRole("link", { name: "Tender Intelligence" })).toBeVisible();
    await expect(page.getByText("Find the Irish tenders worth pursuing.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Growth" })).toBeVisible();
  });

  test("settings: dark mode toggle applies the .dark class and persists", async ({ page }) => {
    await page.goto("/consult");
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByText("Appearance and currency apply")).toBeVisible();
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
    // Reset back to light so other tests in this run start from a known state.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Light" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("logistics: switching to the iAcoustics tab shows engagements", async ({ page }) => {
    await page.goto("/logistics");
    await expect(page.getByText("Plan travel and site mobilisation.")).toBeVisible();
    await page.getByRole("button", { name: /iAcoustics/ }).click();
    await expect(page.getByText("Plan and cost iAcoustics site visits.")).toBeVisible();
    await expect(page.getByText("Manchester listening room survey").first()).toBeVisible();
    await page.getByText("Manchester listening room survey").first().click();
    await expect(page.getByText("No draft yet.")).toBeVisible();
  });

  test("composer: Attach opens a popover and attaching a file shows a chip", async ({ page }) => {
    await page.goto("/consult/new");
    await page.getByRole("button", { name: "Attach" }).click();
    await expect(page.getByText("Drag files here, or click to browse")).toBeVisible();
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.getByText("Drag files here, or click to browse").click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: "site-notes.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("mock file"),
    });
    await expect(page.getByText("site-notes.pdf")).toBeVisible();
  });

  test("build: switching currency updates the indicative cost", async ({ page }) => {
    await page.goto("/build/new");
    const composer = page.getByPlaceholder("Answer here, or describe the room in your own words…");
    await composer.fill("32.4 m2, two extra rooms");
    await composer.press("Enter");
    await expect(page.getByText("€26 900,00")).toBeVisible();
    await page.getByRole("button", { name: "£ GBP" }).click();
    await expect(page.getByText("£23,134.00")).toBeVisible();
  });
});
