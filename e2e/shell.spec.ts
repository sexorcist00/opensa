import { expect, test } from '@playwright/test';

/**
 * UI shell boot flow (plans 051 / 056): the menu lists the configured games; picking a fetch game shows its
 * disclaimer → OK → loading; picking the local game shows the folder prompt. Stops before the heavy download +
 * engine boot (covered elsewhere) so the lane stays fast — the manifest is mocked (hung / aborted) so the tests
 * don't need real game archives.
 */
const GOSTOWN = 'Run Gostown Paradise [web]'; // a fetch game
const SAN_ANDREAS = 'Run San Andreas [local only]'; // a local game

test.describe('ui shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear()); // a clean profile; the disclaimer is shown regardless
  });

  test('the menu lists the games and external links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.sa-logo svg')).toBeVisible();
    await expect(page.getByRole('button', { name: GOSTOWN })).toBeVisible();
    await expect(page.getByRole('button', { name: SAN_ANDREAS })).toBeVisible();
    await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
  });

  test('a fetch game: pick → disclaimer → OK → loading', async ({ page }) => {
    await page.route('**/games/**/manifest.json', () => {
      /* never resolve → the load stays in the loading phase so the preloader is asserted deterministically */
    });
    await page.goto('/');
    const gostown = page.getByRole('button', { name: GOSTOWN });
    // The only fetch game may be greyed out (game-config `disable`, e.g. "Demo is temporarily unavailable") —
    // then the disclaimer→loading flow can't be exercised. Auto-skip until it's re-enabled.
    test.skip(await gostown.isDisabled(), 'fetch demo disabled in game-config');
    await gostown.click();

    const ok = page.getByRole('button', { name: 'OK' });
    await expect(ok).toBeVisible();
    await ok.click();

    await expect(ok).toBeHidden();
    await expect(page.locator('.sa-preloader')).toBeVisible();
  });

  test('shows the error panel with retry when the manifest fails', async ({ page }) => {
    await page.route('**/games/**/manifest.json', (route) => route.abort());
    await page.goto('/');
    const gostown = page.getByRole('button', { name: GOSTOWN });
    test.skip(await gostown.isDisabled(), 'fetch demo disabled in game-config');
    await gostown.click();
    await page.getByRole('button', { name: 'OK' }).click();

    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({ timeout: 30_000 });
  });

  test('a local game: pick → the folder prompt (with disclaimer)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: SAN_ANDREAS }).click();

    await expect(page.getByRole('button', { name: 'Choose game folder' })).toBeVisible();
    await expect(page.getByText('GTA: San Andreas')).toBeVisible(); // the game's disclaimer (unique colon)
  });
});
