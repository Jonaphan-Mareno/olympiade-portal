import { test, expect } from '@playwright/test';

test('login page has Olympia title', async ({ page }) => {
  // Navigate to the login page
  await page.goto('/login');

  // Assert that the page title contains "Olympia"
  await expect(page).toHaveTitle(/Olympia/i);
});
