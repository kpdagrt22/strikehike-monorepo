import { expect, test } from "@playwright/test";

// The case picker (and framer-motion) loads as its own chunk behind a
// same-size trigger placeholder. This checks the placeholder hands over to the
// real trigger and that a case can still be chosen.
test("the picker chunk arrives behind the trigger and a case can be chosen", async ({
  page,
}) => {
  await page.goto("/convergence", { waitUntil: "domcontentloaded" });
  const trigger = page.locator("#cv-trigger-a");
  await expect(trigger).toBeVisible();
  const box = await trigger.boundingBox();
  expect(box).toBeTruthy();

  await trigger.click();
  const listbox = page.locator('[role="listbox"]:visible').first();
  await expect(listbox).toBeVisible();
  const options = listbox.getByRole("option");
  await expect(options.first()).toBeVisible();
  await options.first().click();
  await expect(listbox).toBeHidden();
  await expect(trigger).toBeVisible();
});
