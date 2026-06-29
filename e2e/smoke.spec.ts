import { test, expect } from '@playwright/test';

test('gateway health check', async ({ request }) => {
  const res = await request.get('https://rmg-creator-os.rmasters.group/health');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.status).toBe('ok');
});

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  // Root div always present whether logged in or not
  await expect(page.locator('#root')).toBeAttached();
  const title = await page.title();
  expect(title.length).toBeGreaterThan(0);
});

test('auth state — login or nav', async ({ page }) => {
  const sessionCookie = process.env.E2E_SESSION_COOKIE;
  if (sessionCookie) {
    await page.context().addCookies([{
      name: 'rmg_sess',
      value: sessionCookie,
      domain: 'rmg-creator-os.rmasters.group',
      path: '/',
      httpOnly: true,
      secure: true,
    }]);
  }

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const isLoggedIn = await page.locator('nav a, [href="/"], [href="/produce"], [href="/studio"]').count() > 0
    && !(await page.locator('button:has-text("Sign in"), button:has-text("Login"), button:has-text("Google")').count() > 0);

  if (isLoggedIn) {
    // Verify the three main routes are reachable
    await page.goto('/produce');
    await expect(page.locator('#root')).toBeAttached();
    await page.goto('/studio');
    await expect(page.locator('#root')).toBeAttached();
  } else {
    // Not logged in — login button must be visible
    const loginBtn = page.locator('button:has-text("Sign in"), button:has-text("Login"), button:has-text("Google"), a:has-text("Sign in")');
    await expect(loginBtn.first()).toBeVisible();
    console.log('Note: running unauthenticated. Set E2E_SESSION_COOKIE for full coverage.');
  }
});
