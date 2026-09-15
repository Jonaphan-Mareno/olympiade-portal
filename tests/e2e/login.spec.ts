import { test, expect } from '@playwright/test';

test.describe('Login flow', () => {
  test('login page has Olympia title', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/Olympia/i);
  });

  test('can fill out login form and submit', async ({ page }) => {
    await page.goto('/login');
    
    // Fill the login form
    await page.fill('input[name="email"]', 'admin1@gmail.com');
    await page.fill('input[name="password"]', '111111');
    
    // Click the submit button
    await page.click('button[type="submit"]');
    
    // Check if it redirects or shows a loading state
    // We wait for navigation or an element on the dashboard page
    await page.waitForURL('**/dashboard');
    await expect(page).toHaveURL(/.*\/dashboard/);
  });
});
