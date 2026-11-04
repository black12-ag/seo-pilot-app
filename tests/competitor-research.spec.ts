import { expect, test, type Route } from "@playwright/test";

function required(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Reserved competitor browser fixture missing: ${name}`);
  return value;
}

// The fixture must be a disposable password-mode project whose newest run is
// terminal, open for review, has one source-backed candidate, and has no active workflow.
test("sourced review survives a lost empty-accept reply without starting paid work", async ({
  browser,
}) => {
  const baseURL = new URL(required("COMPETITOR_RESEARCH_BASE_URL")).origin;
  const projectId = required("COMPETITOR_RESEARCH_PROJECT_ID");
  const domain = required("COMPETITOR_RESEARCH_CANDIDATE_DOMAIN");
  const sourceUrl = required("COMPETITOR_RESEARCH_SOURCE_URL");
  const context = await browser.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
  });
  try {
    expect(
      (
        await context.request.post("/api/auth/sign-in/email", {
          data: {
            email: required("COMPETITOR_RESEARCH_OWNER_EMAIL"),
            password: required("COMPETITOR_RESEARCH_OWNER_PASSWORD"),
          },
        })
      ).status(),
    ).toBe(200);
    const page = await context.newPage();
    await page.goto(`/p/${encodeURIComponent(projectId)}/context`);
    await expect(
      page.getByRole("heading", { name: "Competitors", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add competitor" }),
    ).toBeVisible();
    const panel = page.getByRole("region", { name: "Discover competitors" });
    await expect(
      panel.getByRole("heading", { name: "Discover competitors" }),
    ).toBeVisible();
    await expect(panel.getByText(domain, { exact: true })).toBeVisible();
    const source = panel.getByRole("link", { name: "Source page" });
    await expect(source).toHaveAttribute("href", sourceUrl);
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    await expect(panel.getByText(/Captured \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await expect(panel.getByText(/Why suggested:/)).toBeVisible();
    await expect(
      panel.getByRole("link", { name: "Analyze domain" }),
    ).toHaveAttribute(
      "href",
      new RegExp(`domain=${encodeURIComponent(domain)}`),
    );
    const continueReview = panel.getByRole("button", {
      name: "Continue with selected competitors",
    });
    await continueReview.click();
    const emptyReview = page.getByRole("alertdialog", {
      name: "Finish this review without additions?",
    });
    await expect(emptyReview).toContainText("permanently closes review");
    await emptyReview.getByRole("button", { name: "Cancel" }).click();
    await expect(continueReview).toBeVisible();
    const newRun = panel.getByRole("button", { name: "Research again" });
    if (await newRun.isEnabled()) {
      await newRun.click();
      await expect(
        page.getByRole("alertdialog", { name: "Start competitor research?" }),
      ).toBeVisible();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: "Cancel" })
        .click();
    } else {
      await expect(
        panel.getByRole("link", { name: "DataForSEO setup guide" }),
      ).toBeVisible();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(source).toBeVisible();
    await page.reload();
    await expect(
      panel.getByRole("link", { name: "Source page" }),
    ).toHaveAttribute("href", sourceUrl);
    await expect(
      page.getByRole("button", { name: "Add competitor" }),
    ).toBeVisible();
    let interrupted = false;
    const dropAccept = async (route: Route) => {
      const request = route.request();
      if (
        !interrupted &&
        request.method() === "POST" &&
        request.url().includes("_serverFn") &&
        request.postData()?.includes("mutationId") &&
        request.postData()?.includes("selections")
      ) {
        interrupted = true;
        await route.fetch();
        await route.abort();
        return;
      }
      await route.continue();
    };
    await page.route("**/*", dropAccept);
    await continueReview.click();
    await emptyReview
      .getByRole("button", { name: "Finish without adding" })
      .click();
    await expect(
      panel.getByText(/review reply was not confirmed/i),
    ).toBeVisible();
    expect(
      interrupted,
      "the reserved fixture must exercise the real accept transport",
    ).toBe(true);
    await page.unroute("**/*", dropAccept);
    await page.reload();
    await panel
      .getByRole("button", { name: "Check original review receipt" })
      .click();
    await expect(
      panel.getByText(/Historical receipt: 0 selected/),
    ).toBeVisible();
    await expect(panel.getByText(/replayed/)).toBeVisible();
    await expect(
      panel.getByText(/Project context changed since this run/),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});
