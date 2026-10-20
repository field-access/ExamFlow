const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/flashcards-core.js');
const raw = { name: 'Memory', cards: [{ front: 'Why?', back: 'Because.', tags: ['reasoning'] }, { front: 'How?', back: 'Recall.' }] };

test('strict and fenced imports preserve LaTeX, support question/answer aliases, and skip exact duplicates', () => {
  const data = { name: 'Math', cards: [{ question: '$\\log n$?', answer: 'Halving.', tags: ['math', 'math'] }, { front: '$\\log n$?', back: 'Halving.', tags: [] }] };
  const deck = C.parse('```json\n' + JSON.stringify(data) + '\n```');
  assert.equal(deck.cards.length, 1); assert.equal(deck.duplicates, 1);
  assert.equal(deck.cards[0].front, '$\\log n$?'); assert.deepEqual(deck.cards[0].tags, ['math']);
});
test('invalid decks fail atomically with a useful card number', () => {
  assert.throws(() => C.parse('{bad'), /Invalid JSON/);
  assert.throws(() => C.parse(JSON.stringify({ cards: [] })), /non-empty/);
  assert.throws(() => C.parse(JSON.stringify({ cards: [raw.cards[0], { front: ' ', back: 'Answer' }] })), /Card 2 front/);
  assert.throws(() => C.parse(JSON.stringify({ cards: [{ front: 'Q', back: 'A', tags: 'tag' }] })), /tags/);
  assert.throws(() => C.parse(JSON.stringify({ cards: Array(2001).fill(raw.cards[0]) })), /2000/);
});
test('new and lapsed cards move into learning, while successful recall schedules future review', () => {
  const now = 1000000, fresh = C.freshProgress();
  const again = C.schedule(fresh, 'again', now); assert.equal(again.due, now + 60000); assert.equal(again.state, 'learning');
  const hard = C.schedule(fresh, 'hard', now); assert.equal(hard.due, now + 600000);
  const good = C.schedule(fresh, 'good', now); assert.equal(good.due, now + C.DAY); assert.equal(good.state, 'review');
  const easy = C.schedule(good, 'easy', good.due); assert.equal(easy.interval, 3); assert.equal(easy.reviews, 2);
  const lapse = C.schedule(easy, 'again', easy.due); assert.equal(lapse.lapses, 1); assert.equal(lapse.interval, 1 / 1440);
  assert.throws(() => C.schedule(fresh, 'wrong'), /rating/); assert.equal(fresh.reviews, 0);
});
test('due queues prioritize old reviews, exclude future cards and respect topics and limits', () => {
  const deck = C.createDeck(C.parse(JSON.stringify(raw)), 1000);
  deck.cards.push({ ...raw.cards[0], id: 'due', progress: { ...C.freshProgress(), state: 'review', due: 900, interval: 1 } });
  deck.cards[1].progress = C.schedule(C.freshProgress(), 'good', 1000);
  assert.deepEqual(C.queue(deck, { now: 1000, limit: 1 }), ['due']);
  assert.equal(C.queue(deck, { now: 1000 }).length, 2);
  assert.equal(C.queue(deck, { mode: 'browse', now: 1000 }).length, 3);
  assert.deepEqual(C.queue(deck, { mode: 'browse', now: 1000 }), deck.cards.map(c => c.id));
  assert.equal(C.queue(deck, { tag: 'missing' }).length, 0);
  assert.deepEqual(C.counts(deck, 1000), { new: 1, due: 1, scheduled: 1 });
});
test('merging a repeated deck keeps card IDs and progress and only adds new content', () => {
  const deck = C.createDeck(C.parse(JSON.stringify(raw)));
  deck.cards[0].progress = C.schedule(deck.cards[0].progress, 'good', 1000);
  const repeated = C.mergeDeck(deck, C.parse(JSON.stringify(raw))); assert.equal(repeated.added, 0);
  assert.deepEqual(repeated.deck.cards, deck.cards);
  const changed = C.mergeDeck(deck, C.parse(JSON.stringify({ name: 'Memory', cards: [raw.cards[0], { front: 'Transfer?', back: 'Apply.' }] })));
  assert.equal(changed.added, 1); assert.equal(changed.deck.cards.length, 3); assert.equal(deck.cards.length, 2);
});
test('backups preserve review progress, sanitize session references and reject corrupt progress', () => {
  const deck = C.createDeck(C.parse(JSON.stringify(raw)));
  const data = { version: 1, decks: [deck], session: { deckId: deck.id, mode: 'due', queue: deck.cards.map(c => c.id), cursor: 1, revealed: true, ratings: { good: 1 } } };
  const restored = C.validateStore(data); assert.deepEqual(restored.decks[0].cards, deck.cards); assert.equal(restored.session.cursor, 1); assert.equal(restored.session.revealed, false);
  data.session.queue = ['missing']; assert.equal(C.validateStore(data).session, null);
  deck.cards[0].progress.due = -1; assert.throws(() => C.validateStore(data), /progress/);
});

test('review scheduling is bounded and a completed pass does not immediately repeat an Again card', () => {
  const deck = C.createDeck(C.parse(JSON.stringify(raw)), 1000);
  deck.cards.forEach(c => c.progress = C.schedule(c.progress, 'again', 1000));
  assert.deepEqual(C.queue(deck, { now: 1000 }), []);
  assert.equal(C.queue(deck, { now: 61000 }).length, 2);
  assert.equal(C.schedule({ ...C.freshProgress(), state: 'review', interval: 350 }, 'easy', 1000).interval, 365);
});
