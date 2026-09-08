import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function reviewOperationsJourney(page, base, dir) {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.getByLabel("Development persona").selectOption("avery");
  const state = async () =>
    (await page.request.get(`${base}/api/state`)).json();
  const assignment = (await state()).assignments.find(
    (item) => item.reviewerId === "avery",
  );
  await page.goto(`${base}/issues?assignmentId=${assignment.id}`);
  await page.getByRole("button", { name: "Raise issue", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Source reconciliation");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Please explain the ledger variance.");
  await page.getByRole("button", { name: "Create issue", exact: true }).click();
  await page.getByText("Issue created", { exact: true }).waitFor();
  let issue = (await state()).issues.find(
    (item) => item.title === "Source reconciliation",
  );
  assert.ok(issue);
  assert.equal(
    (await state()).assignments.find((item) => item.id === assignment.id)
      .signatureId,
    undefined,
  );
  await page.getByLabel("Development persona").selectOption("publisher");
  await page.goto(`${base}/issues?issueId=${issue.id}`);
  await page
    .getByPlaceholder("Explain the proposed resolution")
    .fill("Reconciled to the signed source ledger.");
  await page
    .getByRole("button", { name: "Propose resolution", exact: true })
    .click();
  await page
    .locator(".we-toast")
    .filter({ hasText: "Resolution proposed" })
    .waitFor();
  await page.getByLabel("Development persona").selectOption("avery");
  await page
    .getByRole("button", { name: "Accept resolution", exact: true })
    .click();
  await page.getByText("Resolution accepted", { exact: true }).waitFor();
  issue = (await state()).issues.find((item) => item.id === issue.id);
  assert.equal(issue.status, "RESOLVED");
  assert.equal(issue.resolution.acceptedBy, "avery");
  await page.screenshot({ path: `${dir}/exceptions.png`, fullPage: true });
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await page.getByRole("button", { name: "Preferences", exact: true }).click();
  await page.getByLabel("Reminder interval (minutes)").fill("120");
  await page.getByLabel("Timezone", { exact: true }).fill("America/New_York");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await page
    .getByText("Notification preferences saved.", { exact: true })
    .waitFor();
  assert.equal(
    (await state()).notificationPreferences[0].reminderIntervalMinutes,
    120,
  );
  await page
    .getByRole("button", { name: "Mark read", exact: true })
    .first()
    .click();
  await expect
    .poll(async () =>
      (await state()).notificationReceipts.some((item) => item.readAt),
    )
    .toBe(true);
  await page.screenshot({ path: `${dir}/notifications.png`, fullPage: true });
  await page
    .getByRole("link", { name: "Open item", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Source reconciliation", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Development persona").selectOption("admin");
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Backup reviewer");
  await page
    .getByLabel("Email", { exact: true })
    .fill("backup@example.invalid");
  await page.getByLabel("Reporting units", { exact: true }).fill("AL");
  await page.getByRole("button", { name: "Save access", exact: true }).click();
  await expect
    .poll(async () =>
      (await state()).users.some(
        (user) => user.email === "backup@example.invalid",
      ),
    )
    .toBe(true);
  const replacement = (await state()).users.find(
    (user) => user.email === "backup@example.invalid",
  );
  await page
    .getByLabel("Assignment", { exact: true })
    .selectOption(assignment.id);
  await page
    .getByLabel("New reviewer", { exact: true })
    .selectOption(replacement.id);
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Primary reviewer is on leave.");
  await page.getByRole("button", { name: "Reassign", exact: true }).click();
  await page.getByText("Review reassigned", { exact: true }).waitFor();
  const updated = (await state()).assignments.find(
    (item) => item.id === assignment.id,
  );
  assert.equal(updated.reviewerId, replacement.id);
  assert.deepEqual(updated.responses, []);
  await page.screenshot({
    path: `${dir}/assignment-administration.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Notifications", exact: true })
    .click();
  await page
    .getByLabel("Reminder target", { exact: true })
    .selectOption(`review:${assignment.id}`);
  await page
    .getByRole("button", { name: "Send reminder", exact: true })
    .click();
  await page.getByText("Reminder queued.", { exact: true }).waitFor();
  assert.ok(
    (await state()).outbox.some(
      (event) =>
        event.type === "REVIEW_NUDGE" &&
        event.recipientId === replacement.id &&
        event.subjectId === assignment.id,
    ),
  );
  for (const width of [1536, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ["admin", "issues", "notifications"]) {
      await page.goto(`${base}/${view}`);
      await page.locator(".we-content h1").waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
        `${view} overflows at ${width}px`,
      );
    }
  }
  return {
    issueAccepted: true,
    preferencesPersisted: true,
    exactIssueLink: true,
    reviewerReassigned: true,
    manualReminder: true,
    responsiveLayouts: true,
  };
}
