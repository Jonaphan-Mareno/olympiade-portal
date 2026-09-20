import { test, expect } from '@playwright/test';

test.describe('Forgot password flow', () => {
  test('login page links to the forgot password page', async ({ page }) => {
    await page.goto('/');

    const link = page.getByRole('link', { name: /forgot your password/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(
      page.getByRole('heading', { name: /reset your password/i })
    ).toBeVisible();
  });

  test('forgot password page renders and accepts an email', async ({
    page,
  }) => {
    await page.goto('/forgot-password');

    await expect(
      page.getByRole('heading', { name: /reset your password/i })
    ).toBeVisible();
    await expect(page.locator('input[name="email"]')).toBeVisible();

    await page.fill('input[name="email"]', 'teacher@example.com');
    await page.click('button[type="submit"]');

    // The action never reveals whether the account exists — the same success
    // message appears either way.
    await expect(
      page.getByText(/reset link is on its way/i)
    ).toBeVisible();
  });

  test('reset password page renders and validates locally', async ({
    page,
  }) => {
    await page.goto('/reset-password');

    await expect(
      page.getByRole('heading', { name: /choose a new password/i })
    ).toBeVisible();
    await expect(page.locator('input[name="password"]')).toBeVisible();
    await expect(
      page.locator('input[name="confirmPassword"]')
    ).toBeVisible();

    // Mismatched confirmation is caught client-side before any submit
    await page.fill('input[name="password"]', 'new-password');
    await page.fill('input[name="confirmPassword"]', 'different');
    await page.click('button[type="submit"]');

    await expect(
      page.getByText(/invalid or has expired/i)
    ).toBeVisible({ timeout: 10_000 });
  });
});
