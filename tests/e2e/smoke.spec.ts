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
  "/socials/marketing",
  "/socials/leads",
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

  test("socials: lead generation research reveals the ranked list and company panel", async ({ page }) => {
    await page.goto("/socials/leads");
    await page.getByText("Research Berlin").click();
    await expect(page.getByText("Berlin research complete.")).toBeVisible({ timeout: 5000 });
    await page.getByText("Example Post GmbH").click();
    await expect(page.getByText("Prepare outreach")).toBeVisible();
  });

  test("mobile: sidebar collapses to a bottom tab bar", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/consult");
    await expect(page.getByRole("link", { name: "Consult" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Build" })).toBeVisible();
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

  test("sidebar: Logistics carries the Smart Studio badge", async ({ page }) => {
    await page.goto("/logistics");
    await expect(page.getByRole("link", { name: /Logistics/ }).getByText("SS")).toBeVisible();
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
