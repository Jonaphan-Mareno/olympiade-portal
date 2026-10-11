import { test, expect } from '@playwright/test';

test.describe('Signup flow', () => {
  test('signup page renders correctly without token', async ({ page }) => {
    await page.goto('/signup');
    await expect(page.locator('h1')).toHaveText(/Apply as an Organiser/i);
    
    // Check if form fields are visible
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
  });

  test('signup page renders correctly with invite token', async ({ page }) => {
    await page.goto('/signup?inviteToken=12345');
    await expect(page.locator('h1')).toHaveText(/Claim Your Account/i);
    
    // Check if form fields are visible
    await expect(page.locator('input[name="name"]')).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    
    // Check for inviteToken hidden field
    await expect(page.locator('input[name="inviteToken"]')).toHaveValue('12345');
  });

  test('password visibility can be toggled', async ({ page }) => {
    await page.goto('/signup');

    const password = page.locator('input[name="password"]');
    await expect(password).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });
});

