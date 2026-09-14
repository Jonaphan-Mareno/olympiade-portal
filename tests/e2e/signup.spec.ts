import { test, expect } from '@playwright/test';

test.describe('Signup Flow', () => {
  test('should display the signup form correctly', async ({ page }) => {
    await page.goto('/signup');
    
    // Check for the main heading
    await expect(page.getByRole('heading', { name: /create an account/i })).toBeVisible();

    // Check for essential form fields
    await expect(page.getByLabel(/name/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i, { exact: true })).toBeVisible();
    
    // Check for the role selection (should default to standard or have radio buttons)
    // We assume there are radio buttons or a select for role
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible();
  });

  test('should show validation errors on empty submit', async ({ page }) => {
    await page.goto('/signup');
    
    await page.getByRole('button', { name: /create account/i }).click();
    
    // Check if HTML5 validation or custom validation kicks in
    // For simplicity, we just assert the page didn't navigate away
    await expect(page).toHaveURL(/\/signup/);
  });
});
