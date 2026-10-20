/* Optional browser smoke test. See tests/README.md for the local server and Playwright setup. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require(process.env.EXAMFLOW_PLAYWRIGHT || 'playwright');
const KEY = 'examflow_flashcards_v1';
const baseURL = process.env.EXAMFLOW_TEST_URL || 'http://127.0.0.1:8765';
const deckJSON = JSON.stringify({ name: 'Safety & math', cards: [
  { front: '<img src=x onerror="window.injected=true"> **Recall** $\\nabla f$', back: 'Safe answer $\\nu$.' },
  { front: 'Second?', back: 'Second answer.' }
] });

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [];
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(baseURL);
    await page.click('#navFlashcards');
    assert.ok((await page.locator('.fc-heading').boundingBox()).y < 200, 'page should sit below the header');
    await page.click('#fcDecks [data-fc=open-import]');
    await page.fill('#fcJson', '{invalid');
    await page.click('[data-fc=preview]');
    assert.match(await page.locator('#fcImportStatus').textContent(), /Invalid JSON/);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), KEY), null);
    await page.fill('#fcJson', deckJSON);
    await page.click('[data-fc=preview]');
    await page.click('[data-fc=save-import]');
    const store = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY);
    assert.equal((await store()).decks[0].cards.length, 2);
    assert.equal(await page.locator('.fc-deck-options select').first().isVisible(), false, 'session settings stay collapsed');
    await page.screenshot({ path: 'test-results/flashcards-desktop.png', fullPage: true });
    await page.click('[data-mode=due]');
    assert.equal(await page.locator('[data-fc=rate]').count(), 0, 'grading requires a reveal');
    assert.equal(await page.locator('#fcFront img').count(), 0, 'raw HTML must stay inert');
    assert.match(await page.locator('#fcFront').textContent(), /\\nabla f/);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#fcBack').textContent(), /\\nu/);
    await page.waitForFunction(() => document.querySelector('.fc-flip-card').classList.contains('is-flipped'));
    assert.equal(await page.locator('#fcFrontPanel').getAttribute('aria-hidden'), 'true');
    await page.keyboard.press('Space');
    assert.equal((await store()).session.revealed, false);
    assert.equal(await page.locator('[data-fc=rate]').count(), 0);
    await page.keyboard.press('Space');
    await page.keyboard.press('3');
    assert.equal((await store()).session.cursor, 1);
    assert.equal((await store()).activity[0].reviewed, 1);
    await page.keyboard.press('u');
    assert.equal((await store()).session.cursor, 0);
    assert.equal((await store()).decks[0].cards[0].progress.reviews, 0);
    assert.equal((await store()).activity.length, 0);
    await page.keyboard.press('2');
    assert.equal((await store()).decks[0].cards[0].progress.state, 'learning');
    await page.reload(); await page.click('#navFlashcards');
    assert.match(await page.locator('#fcStudyMeta').textContent(), /1 of 2/);
    await page.keyboard.press('Enter'); await page.keyboard.press('1');
    assert.match(await page.locator('.fc-complete').textContent(), /2 cards/);
    assert.equal((await store()).activity[0].reviewed, 2);
    await page.click('[data-fc=library]');
    await page.click('[data-mode=browse]');
    const progressBefore = (await store()).decks[0].cards.map(c => c.progress);
    await page.keyboard.press('Enter'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter');
    assert.deepEqual((await store()).decks[0].cards.map(c => c.progress), progressBefore, 'browse should not grade');
    await page.keyboard.press('e');
    await page.fill('#fcEditBack', 'A revised explanation.'); await page.keyboard.press('Control+Enter');
    assert.equal((await store()).decks[0].cards[1].progress.state, 'new');
    await page.click('[data-fc=library]');
    await page.click('.fc-deck summary');
    const downloadEvent = page.waitForEvent('download'); await page.click('[data-fc=export]');
    const downloaded = JSON.parse(await fs.readFile(await (await downloadEvent).path(), 'utf8'));
    assert.equal(downloaded.cards[1].back, 'A revised explanation.');
    await page.keyboard.press('n');
    await page.fill('#fcJson', JSON.stringify(downloaded)); await page.keyboard.press('Control+Enter');
    assert.equal((await store()).decks.length, 1); assert.equal((await store()).decks[0].cards.length, 2);
    assert.equal((await store()).decks[0].cards[0].progress.reviews, 1);
    await page.keyboard.press('?');
    assert.equal(await page.locator('#fcKeyDialog').evaluate(el => el.open), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#fcKeyDialog').evaluate(el => el.open), false);
    // Portable backups carry scheduling and calendar records; invalid ones are rejected before other keys change.
    await page.evaluate(() => showView('settings'));
    const exportEvent = page.waitForEvent('download'); await page.evaluate(() => exportData());
    const backup = JSON.parse(await fs.readFile(await (await exportEvent).path(), 'utf8'));
    assert.equal(backup.flashcards.activity[0].reviewed, 2);
    await page.evaluate(() => localStorage.removeItem('examflow_flashcards_v1'));
    page.once('dialog', dialog => dialog.accept());
    await page.locator('input[onchange="importDataFile(event)"]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(key => JSON.parse(localStorage.getItem(key))?.decks.length === 1, KEY);
    const corrupt = structuredClone(backup); corrupt.flashcards.decks[0].cards[0].progress.due = -1;
    corrupt.plans = [{ id: 'bad-import-must-not-write' }];
    await page.locator('input[onchange="importDataFile(event)"]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(corrupt)) });
    await page.waitForFunction(() => document.getElementById('dataImportStatus').textContent.includes('Invalid flashcard'));
    assert.ok(!(await page.evaluate(() => localStorage.getItem('examflow_plans_v2')) || '').includes('bad-import-must-not-write'));
    await page.evaluate(() => showView('home'));
    await page.evaluate(() => chooseStudyDate(studyDateKey(Date.now())));
    assert.match(await page.locator('.study-session-grid').textContent(), /2 card reviews/);
    // Save a quiz answer into the same library, including its full explanation.
    await page.evaluate(() => Flashcards.saveQuestion({ type: 'mcq', text: 'Which order?', options: ['Sorted', 'Any'], answer: 'A', explanation: 'Sorted data supports safe elimination.' }, 'Quiz source'));
    await page.evaluate(() => Flashcards.saveQuestion({ type: 'mcq', text: 'Which order?', options: ['Sorted', 'Any'], answer: 'A', explanation: 'Sorted data supports safe elimination.' }, 'Quiz source'));
    const saved = (await store()).decks.find(d => d.name === 'Saved quiz explanations');
    assert.equal(saved.cards.length, 1); assert.match(saved.cards[0].back, /Sorted data/);
    await page.evaluate(() => { showView('home'); document.getElementById('homeJson').value = JSON.stringify({ name: 'Practice UI', sections: [{ name: 'Practice', questions: [{ question: 'Which structure supports BFS?', options: ['Queue', 'Stack'], answer: 'A', explanation: 'A queue visits earlier discoveries first.' }] }] }); startHomeQuiz(); setMode('practice'); });
    await page.click('#options .option:first-child'); await page.keyboard.press('Enter');
    await page.click('#practiceAnswerPanel .save-flashcard');
    assert.equal((await store()).decks.find(d => d.name === 'Saved quiz explanations').cards.length, 2);
    await page.evaluate(() => setMode('exam'));
    assert.equal(await page.locator('#practiceAnswerPanel .save-flashcard').isVisible(), false);
    await page.evaluate(() => finishTest()); await page.click('.result-question'); await page.click('.result-detail .save-flashcard');
    assert.equal((await store()).decks.find(d => d.name === 'Saved quiz explanations').cards.length, 2);
    // Explicitly simulate a full browser storage cache. The grade must remain uncommitted.
    await page.evaluate(() => showView('flashcards')); await page.click('.fc-deck:first-child [data-mode=due]');
    await page.keyboard.press('Enter');
    const beforeFailure = await store();
    await page.evaluate(() => { window.originalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'examflow_flashcards_v1') throw new DOMException('Full', 'QuotaExceededError'); return window.originalSetItem.call(this, key, value); }; });
    await page.click('[data-rating=good]');
    assert.deepEqual(await store(), beforeFailure); assert.match(await page.locator('#fcNotice').textContent(), /could not save/);
    await page.evaluate(() => Storage.prototype.setItem = window.originalSetItem);
    await page.click('[data-rating=good]'); await page.click('[data-fc=library]');
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at ' + width);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/flashcards-mobile.png', fullPage: true });
    await page.click('.fc-deck:first-child [data-mode=browse]'); await page.keyboard.press('Enter');
    await page.screenshot({ path: 'test-results/flashcards-review-mobile.png', fullPage: true });
    await page.evaluate(() => setTheme('dark'));
    await page.screenshot({ path: 'test-results/flashcards-dark-mobile.png', fullPage: true });
    await page.click('.mobile-menu-toggle');
    await page.click('#mobileNav button:has-text("Home")');
    assert.equal(await page.locator('#homeView').isVisible(), true);
    await page.click('.mobile-menu-toggle'); await page.click('#mobileNav button:has-text("Flashcards")');
    assert.equal(await page.locator('#fcStudy').isVisible(), true);
    await page.evaluate(() => showView('settings'));
    page.once('dialog', dialog => dialog.accept());
    await Promise.all([page.waitForEvent('load'), page.click('button[onclick="resetData()"]')]);
    await page.evaluate(() => showView('flashcards'));
    assert.equal((await store())?.decks?.length || 0, 0, 'reset must not restore deleted decks');
    assert.deepEqual(errors, []);
    console.log('Flashcard browser checks passed: import, duplicate merge, safe text/math, keyboard, scheduling, undo, reload, browse, edit, export/restore, calendar, quiz saves, storage failure, responsive layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

