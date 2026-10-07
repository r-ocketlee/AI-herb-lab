const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => {
      if (!route.request().url().startsWith('http://127.0.0.1:5187/')) { external.push(route.request().url()); return route.abort(); }
      return route.continue();
    });
    await page.goto('http://127.0.0.1:5187/tests/browser-repeat.html');
    await page.waitForFunction(() => !!window.qa);
    const results = [];
    for (let round = 1; round <= 2; round++) {
      await page.evaluate(() => window.qa.enter('welcomeGate'));
      await page.waitForSelector('.gate-scene--b.is-on', { timeout: 8000 });
      await page.waitForSelector('.tutorial-card.is-in');
      assert.equal(await page.locator('.gate-btn').count(), 0, 'entry should have no yes/no buttons');
      assert.equal(await page.locator('.tcard-backdrop').count(), 0, 'demo should not obscure the scene');
      const cue = await page.locator('.tcard-window').evaluate(el => {
        const r = el.getBoundingClientRect();
        return { width: r.width, height: r.height, background: getComputedStyle(el).backgroundColor };
      });
      assert.deepEqual(cue, { width: 1440, height: 810, background: 'rgba(0, 0, 0, 0)' });
      await page.waitForFunction(() => document.querySelector('.gate-seed-image').naturalWidth > 0);
      const seed = await page.locator('.gate-seed').boundingBox();
      const hand = { present: true, x: (seed.x + seed.width / 2) / 1440, y: (seed.y + seed.height / 2) / 810 };
      await page.evaluate(p => window.qa.hand(p), hand);
      await page.waitForSelector('.tutorial-card', { state: 'detached' });
      await page.waitForTimeout(900);
      assert.deepEqual(await page.evaluate(() => window.qa.status().transitions), [], 'brief hover must not start the experience');
      await page.evaluate(() => window.qa.hand({ present: false }));
      await page.waitForTimeout(250);
      await page.evaluate(p => window.qa.hand(p), hand);
      await page.waitForTimeout(1800);
      assert.deepEqual(await page.evaluate(() => window.qa.status().transitions), [], 'leaving the seed must reset dwell');
      await page.waitForFunction(() => window.qa.status().transitions.length === 1);
      assert.deepEqual(await page.evaluate(() => window.qa.status().transitions), ['intro']);
      await page.waitForTimeout(500);
      assert.deepEqual(await page.evaluate(() => window.qa.status().transitions), ['intro'], 'confirm only once');
      results.push({ state: 'welcomeGate', round, status: await page.evaluate(() => window.qa.status()) });
      await page.evaluate(() => window.qa.exit());
      assert.deepEqual(await page.evaluate(() => window.qa.status().observers), [0, 0]);
      console.log('PASS welcomeGate round', round, 'seed image, inline tutorial, interrupted dwell and one-shot confirmation');
    }
    for (const state of ['seedSelect', 'bloom']) {
      for (let round = 1; round <= 2; round++) {
        await page.evaluate(name => window.qa.enter(name), state);
        if (state === 'seedSelect') {
          // A ready visitor should take control immediately instead of waiting
          // through the entire tutorial animation.
          await page.evaluate(() => window.qa.hand({ present: true, x: 0.5, y: 0.5 }));
        }
        await page.waitForFunction(() => window.qa.status().hintActive, null, { timeout: 18000 });
        await page.waitForTimeout(400);
        assert.equal(await page.locator('.guide-top .rt-ch').count(), 0, 'live instructions use whole-text fade');
        if (state === 'seedSelect') {
          assert.ok(Number(await page.evaluate(() => window.qa.status().seedOpacity)) > 0, 'seed cursor should be visible');
          await page.waitForFunction(() => !!window.qa.target(), null, { timeout: 3000 });
          const target = await page.evaluate(() => window.qa.target());
          assert.ok(target, 'a selectable appliance should be projected');
          await page.evaluate((p) => window.qa.hand({ present: true, x: p.x, y: p.y }), target);
          await page.waitForTimeout(500);
          assert.equal(await page.evaluate(() => window.qa.status().angularVelY), 0, 'engaged appliance must stop moving');
          // The canceled demo previously restarted the carousel at 1.6s.
          await page.waitForTimeout(1200);
          assert.equal(await page.evaluate(() => window.qa.status().angularVelY), 0, 'canceled demo must not steer live interaction');
        } else {
          await page.evaluate(() => window.qa.pose({ present: true, wristY: 0.01, shoulderWidth: 0.3 }));
          await page.waitForFunction(() => document.querySelector('.bloom-flare')?.classList.contains('is-on'), null, { timeout: 5000 });
        }
        const status = await page.evaluate(() => window.qa.status());
        assert.equal(status.exited, false);
        assert.equal(status.tutorials, 0);
        results.push({ state, round, status });
        console.log('PASS', state, 'round', round, 'tutorial closes and input is enabled');
        await page.evaluate(() => window.qa.exit());
        assert.deepEqual(await page.evaluate(() => window.qa.status().observers), [0, 0]);
      }
    }

    // The exhibition display may run at either 1080p or 4K. The card token
    // should preserve the same 50%-of-height composition at both resolutions.
    const cardSizes = [];
    for (const viewport of [
      { width: 1920, height: 1080, expectedToken: 540 },
      { width: 3840, height: 2160, expectedToken: 1080 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.evaluate(() => window.qa.enter('card'));
      await page.waitForFunction(() => !!window.qa.status().tokenRect, null, { timeout: 5000 });
      const status = await page.evaluate(() => window.qa.status());
      assert.ok(Math.abs(status.tokenRect.width - viewport.expectedToken) <= 2,
        `card token width should be ${viewport.expectedToken}px at ${viewport.width}x${viewport.height}`);
      assert.ok(Math.abs(status.tokenRect.height - viewport.expectedToken) <= 2,
        `card token height should be ${viewport.expectedToken}px at ${viewport.width}x${viewport.height}`);
      assert.equal(status.countdown, '30', 'result countdown must remain unchanged');
      assert.match(status.guideText, /집에서 심어보세요/, 'result copy must remain unchanged');
      cardSizes.push({ viewport, tokenRect: status.tokenRect, countdown: status.countdown });
      console.log('PASS card', `${viewport.width}x${viewport.height}`, `${status.tokenRect.width}x${status.tokenRect.height}`);
      await page.evaluate(() => window.qa.exit());
      assert.deepEqual(await page.evaluate(() => window.qa.status().observers), [0, 0]);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    fs.writeFileSync('tests/browser-results.json', JSON.stringify({ results, cardSizes, errors, external }, null, 2));
  } finally { await browser.close(); }
})().catch(err => { console.error(err); process.exitCode = 1; });
