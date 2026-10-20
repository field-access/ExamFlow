/* Flashcard data and scheduling are independent of the page and browser storage. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FlashcardsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000, MAX_CARDS = 2000, MAX_TEXT = 20000, MAX_BYTES = 4000000;
  const uid = () => typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  const fingerprint = card => JSON.stringify([card.front.trim(), card.back.trim()]);
  function text(value, label, max = MAX_TEXT) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(label + ' must be non-empty text.');
    if (value.length > max) throw new Error(label + ' is too long (maximum ' + max + ' characters).');
    return value.trim();
  }
  function normalizeCard(card, index) {
    if (!card || typeof card !== 'object' || Array.isArray(card)) throw new Error('Card ' + (index + 1) + ' must be an object.');
    const front = text(card.front ?? card.question, 'Card ' + (index + 1) + ' front');
    const back = text(card.back ?? card.answer, 'Card ' + (index + 1) + ' back');
    if (card.tags !== undefined && (!Array.isArray(card.tags) || card.tags.length > 20 || card.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 60))) {
      throw new Error('Card ' + (index + 1) + ' tags must be an array of up to 20 short text labels.');
    }
    return { front, back, tags: [...new Set((card.tags || []).map(t => t.trim()))] };
  }
  function parse(input) {
    if (typeof input !== 'string' || !input.trim()) throw new Error('Paste a flashcard deck first.');
    if (input.length > MAX_BYTES) throw new Error('This deck is too large. Split it into smaller decks (under 4 MB).');
    let source = input.trim().replace(/^\uFEFF/, '');
    const fence = source.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
    if (fence) source = fence[1].trim();
    let data;
    try { data = JSON.parse(source); } catch (_) { throw new Error('Invalid JSON. Check commas, quotes, and escaped LaTeX backslashes. Paste only the JSON or its code block.'); }
    const cards = Array.isArray(data) ? data : data?.cards;
    if (!Array.isArray(cards) || !cards.length) throw new Error('Use a deck with a non-empty "cards" array. Each card needs "front" and "back".');
    if (cards.length > MAX_CARDS) throw new Error('A deck can contain up to ' + MAX_CARDS + ' cards.');
    const name = Array.isArray(data) ? 'Untitled deck' : text(data.name ?? 'Untitled deck', 'Deck name', 160);
    const description = !Array.isArray(data) && data.description !== undefined ? text(data.description, 'Description', 1000) : '';
    const seen = new Set(), unique = [];
    cards.map(normalizeCard).forEach(card => { const key = fingerprint(card); if (!seen.has(key)) { seen.add(key); unique.push(card); } });
    return { name, description, cards: unique, duplicates: cards.length - unique.length };
  }
  function freshProgress() { return { state: 'new', due: 0, interval: 0, reviews: 0, lapses: 0, lastReviewed: 0 }; }
  function schedule(progress, rating, now = Date.now()) {
    if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error('Unknown review rating.');
    const p = { ...freshProgress(), ...progress }, learning = p.state !== 'review';
    let interval;
    if (rating === 'again') interval = 1 / 1440;
    else if (learning) interval = { hard: 10 / 1440, good: 1, easy: 4 }[rating];
    else interval = Math.min(365, Math.max(1, Math.round(p.interval * { hard: 1.2, good: 2.2, easy: 3.2 }[rating])));
    return { state: rating === 'again' || (learning && rating === 'hard') ? 'learning' : 'review', due: now + Math.round(interval * DAY), interval, reviews: p.reviews + 1, lapses: p.lapses + (rating === 'again' ? 1 : 0), lastReviewed: now };
  }
  function createDeck(parsed, now = Date.now()) {
    return { id: uid(), name: parsed.name, description: parsed.description || '', createdAt: now, updatedAt: now, cards: parsed.cards.map(card => ({ ...card, id: uid(), progress: freshProgress() })) };
  }
  function mergeDeck(deck, parsed, now = Date.now()) {
    const keys = new Set(deck.cards.map(fingerprint));
    const added = parsed.cards.filter(c => !keys.has(fingerprint(c)));
    if (deck.cards.length + added.length > MAX_CARDS) throw new Error('The combined deck exceeds ' + MAX_CARDS + ' cards.');
    return { deck: { ...deck, updatedAt: now, cards: [...deck.cards, ...added.map(c => ({ ...c, id: uid(), progress: freshProgress() }))] }, added: added.length };
  }
  function counts(deck, now = Date.now()) {
    return deck.cards.reduce((n, card) => {
      if (card.progress.state === 'new') n.new++;
      else if (card.progress.due <= now) n.due++;
      else n.scheduled++;
      return n;
    }, { new: 0, due: 0, scheduled: 0 });
  }
  function queue(deck, { mode = 'due', limit = 20, shuffle = false, tag = '', now = Date.now() } = {}) {
    let cards = deck.cards.filter(c => !tag || c.tags.includes(tag));
    if (mode === 'due') cards = cards.filter(c => c.progress.state === 'new' || c.progress.due <= now);
    if (mode === 'due') cards.sort((a, b) => (a.progress.state === 'new') - (b.progress.state === 'new') || a.progress.due - b.progress.due);
    if (shuffle) for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    return cards.slice(0, Math.max(1, Math.min(MAX_CARDS, limit))).map(c => c.id);
  }
  function validateStore(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.decks) || data.decks.length > 500) throw new Error('Invalid flashcard backup.');
    const deckIds = new Set();
    const decks = data.decks.map(deck => {
      if (!deck || typeof deck.id !== 'string' || !deck.id || deckIds.has(deck.id) || !Array.isArray(deck.cards) || !deck.cards.length || deck.cards.length > MAX_CARDS) throw new Error('Invalid flashcard deck in backup.');
      deckIds.add(deck.id);
      const cardIds = new Set();
      const cards = deck.cards.map((card, i) => {
        const content = normalizeCard(card, i), p = card.progress;
        if (typeof card.id !== 'string' || !card.id || cardIds.has(card.id) || !p || !['new', 'learning', 'review'].includes(p.state) || ['due', 'interval', 'reviews', 'lapses', 'lastReviewed'].some(k => !Number.isFinite(p[k]) || p[k] < 0)) throw new Error('Invalid flashcard review progress in backup.');
        cardIds.add(card.id);
        return { ...content, id: card.id, progress: { state: p.state, due: p.due, interval: p.interval, reviews: p.reviews, lapses: p.lapses, lastReviewed: p.lastReviewed } };
      });
      return { id: deck.id, name: text(deck.name, 'Deck name', 160), description: deck.description ? text(deck.description, 'Description', 1000) : '', createdAt: Number(deck.createdAt) || 0, updatedAt: Number(deck.updatedAt) || 0, cards };
    });
    // Active sessions are disposable; accept them only when all referenced cards exist.
    let session = null;
    const s = data.session, deck = s && decks.find(d => d.id === s.deckId);
    if (deck && ['due', 'all', 'browse'].includes(s.mode) && Array.isArray(s.queue) && s.queue.length && s.queue.length <= MAX_CARDS && new Set(s.queue).size === s.queue.length && s.queue.every(id => deck.cards.some(c => c.id === id)) && Number.isInteger(s.cursor) && s.cursor >= 0 && s.cursor <= s.queue.length) {
      session = { deckId: s.deckId, mode: s.mode, queue: s.queue, cursor: s.cursor, revealed: false, startedAt: Number(s.startedAt) || Date.now(), ratings: {} };
      for (const k of ['again', 'hard', 'good', 'easy']) session.ratings[k] = Number.isInteger(s.ratings?.[k]) && s.ratings[k] >= 0 ? s.ratings[k] : 0;
    }
    const activity = Array.isArray(data.activity) ? data.activity.filter(a => a && typeof a.deckId === 'string' && typeof a.name === 'string' && a.name.length <= 160 && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && Number.isInteger(a.reviewed) && a.reviewed > 0 && typeof a.updatedAt === 'string' && Number.isFinite(Date.parse(a.updatedAt))).slice(-730).map(a => ({ deckId: a.deckId, name: a.name, date: a.date, reviewed: a.reviewed, updatedAt: a.updatedAt })) : [];
    return { version: 1, decks, session, activity };
  }
  return { DAY, MAX_CARDS, uid, fingerprint, parse, normalizeCard, freshProgress, schedule, createDeck, mergeDeck, counts, queue, validateStore };
});
