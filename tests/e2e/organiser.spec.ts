import { test, expect } from '@playwright/test';

test.describe('Organiser Flow (Unauthenticated)', () => {
  test('should redirect unauthenticated users to login when accessing dashboard', async ({ page }) => {
    // Attempt to access an organiser dashboard
    await page.goto('/organiser');
    
    // The middleware should intercept and redirect to /login
    await expect(page).toHaveURL(/.*\/login/);
    
    // Also check a nested route
    await page.goto('/organiser/olympiads/some-uuid/rounds/create');
    await expect(page).toHaveURL(/.*\/login/);
  });
});
