(function () {
  'use strict';
  const C = window.FlashcardsCore, $ = id => document.getElementById(id);
  const KEY = 'examflow_flashcards_v1';
  let state = { version: 1, decks: [], session: null, activity: [] }, pending = null, undo = null, editor = false, readFailed = false;
  const example = { name: 'Binary search · reasoning', description: 'Understand why halving works, then transfer the idea.', cards: [
    { front: 'Why must data be sorted before binary search?', back: 'Sorted order tells us which **half can be discarded** after comparing the target with the middle element.', tags: ['algorithms', 'reasoning'] },
    { front: 'The middle value is smaller than the target. Which half can you discard, and why?', back: 'Discard the middle value and everything to its left. Every value there is at most the middle value, so none can equal the larger target.', tags: ['algorithms'] },
    { front: 'After each step, how does the size of the remaining search space change?', back: 'It is roughly **halved**. After $k$ steps, about $n / 2^k$ candidates remain.', tags: ['complexity'] },
    { front: 'How many halvings reduce 1,024 candidates to one?', back: '**10**, because $2^{10} = 1024$. This is why binary search takes $O(\\log n)$ comparisons.', tags: ['complexity'] },
    { front: 'How could the same idea find the smallest feasible capacity for a machine?', back: 'If every capacity above a feasible one is also feasible, test the middle capacity. Keep the upper half when it fails; keep the lower half when it succeeds. The **monotonic feasibility rule** replaces sorted data.', tags: ['transfer'] }
  ] };
  const html = value => esc(String(value ?? ''));
  const copy = value => JSON.parse(JSON.stringify(value));
  const icon = name => '<svg class="ui-icon" aria-hidden="true"><use href="#icon-' + name + '"/></svg>';
  const button = (action, label, extra = '') => '<button class="btn" data-fc="' + action + '" ' + extra + '>' + label + '</button>';
  function notice(message, error = false) { if (!error) { $('fcNotice').hidden = true; toast(message); return; } $('fcNotice').hidden = false; $('fcNotice').textContent = message; $('fcNotice').classList.add('fc-error'); }
  function read() {
    const raw = localStorage.getItem(KEY);
    state = raw ? C.validateStore(JSON.parse(raw)) : { version: 1, decks: [], session: null, activity: [] };
    readFailed = false;
  }
  function save(next) {
    if (readFailed) { notice('Saved flashcard data needs recovery before you can make changes. Export a backup from Settings first.', true); return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      state = next;
      if ($('fcNotice').classList.contains('fc-error')) $('fcNotice').hidden = true;
      if (typeof schedulePersistentBackup === 'function') schedulePersistentBackup();
      return true;
    } catch (_) { notice('Your browser could not save this change. Free some storage or export a backup before trying again. Your previous progress is unchanged.', true); return false; }
  }
  function duration(days) {
    if (days < 1 / 24) return Math.max(1, Math.round(days * 1440)) + ' min';
    if (days < 1) return Math.round(days * 24) + ' hr';
    return Math.round(days) + (Math.round(days) === 1 ? ' day' : ' days');
  }
  function dueLabel(deck) {
    const dates = deck.cards.filter(c => c.progress.state !== 'new').map(c => c.progress.due);
    if (!dates.length) return 'Ready for your first review';
    const next = Math.min(...dates);
    if (next <= Date.now()) return 'Review available now';
    return 'Next review ' + new Date(next).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function rich(id, content) { setQuizRichText($(id), content, { literalNewlines: false }); renderAllQuizMath($(id)); }
  function refresh() {
    undo = null; editor = false;
    try { read(); } catch (_) { readFailed = true; notice('Saved flashcard data could not be read. Export your app backup from Settings before resetting data.', true); return; }
    render();
    if (state.session && $('flashcardsView').classList.contains('active')) { $('fcStudyTitle').setAttribute('tabindex', '-1'); $('fcStudyTitle').focus({ preventScroll: true }); }
  }
  function render() {
    const studying = !!state.session;
    $('flashcardsView').classList.toggle('is-studying', studying);
    $('fcLibrary').hidden = studying; $('fcStudy').hidden = !studying;
    if (studying) renderStudy(); else renderLibrary();
  }
  function renderLibrary() {
    const totals = state.decks.reduce((n, d) => { const c = C.counts(d); n.due += c.due; n.new += c.new; n.total += d.cards.length; return n; }, { due: 0, new: 0, total: 0 });
    $('fcStats').innerHTML = [[totals.due, 'Due for review'], [totals.new, 'New to learn'], [totals.total, 'Cards saved']].map(([n, label]) => '<div class="fc-stat"><strong>' + n + '</strong><span>' + label + '</span></div>').join('');
    $('fcDeckCount').textContent = state.decks.length + (state.decks.length === 1 ? ' deck' : ' decks');
    if (!state.decks.length) {
      $('fcDecks').innerHTML = '<div class="fc-empty">' + icon('bookmark') + '<h3>Your next idea starts here</h3><p>Paste AI-generated flashcards and build a library you can return to. Review a little each day.</p>' + button('open-import', 'Add your first deck') + ' ' + button('example', 'Try a sample deck') + '</div>'; return;
    }
    $('fcDecks').innerHTML = state.decks.map(deck => {
      const n = C.counts(deck), tags = [...new Set(deck.cards.flatMap(c => c.tags))].sort();
      return '<article class="fc-deck" data-deck="' + html(deck.id) + '"><h3>' + html(deck.name) + '</h3>' + (deck.description ? '<p class="fc-description">' + html(deck.description) + '</p>' : '') + '<p class="fc-deck-counts">' + n.due + ' due · ' + n.new + ' new · ' + deck.cards.length + ' cards</p>' +
        '<div class="fc-actions"><button class="btn primary" data-fc="start" data-mode="due">Study</button>' + button('start', 'Browse', 'data-mode="browse"') + '</div><details><summary>Options</summary>' +
        '<div class="fc-deck-options"><label>Session size<select data-option="limit"><option value="10">10 cards</option><option value="20" selected>20 cards</option><option value="50">50 cards</option><option value="2000">All cards</option></select></label><label>Topic<select data-option="tag"><option value="">All topics</option>' + tags.map(t => '<option value="' + html(t) + '">' + html(t) + '</option>').join('') + '</select></label></div><label class="fc-shuffle"><input type="checkbox" data-option="shuffle">Shuffle this session</label>' +
        '<p>' + html(dueLabel(deck)) + '</p><div class="fc-actions">' + button('start', 'Practice all', 'data-mode="all"') + button('rename', 'Rename') + button('export', 'Export') + button('delete', 'Delete deck') + '</div><small>Practice all updates your schedule. Browse keeps it unchanged.</small></details></article>';
    }).join('');
  }
  function openImport() {
    if (state.session && !save({ ...state, session: null })) return;
    undo = null; render(); $('flashcardsView').classList.add('is-importing'); $('fcImport').hidden = false; $('fcJson').focus();
  }
  function closeImport() { $('fcImport').hidden = true; $('flashcardsView').classList.remove('is-importing'); $('flashcardsView').querySelector('.fc-heading [data-fc=open-import]').focus(); }
  function preview() {
    try {
      pending = C.parse($('fcJson').value);
      $('fcImportStatus').classList.remove('fc-error');
      $('fcImportStatus').textContent = pending.cards.length + ' valid cards' + (pending.duplicates ? ' · ' + pending.duplicates + ' duplicate cards skipped' : '') + '.';
      const match = state.decks.find(d => d.name.toLowerCase() === pending.name.toLowerCase()) || state.decks.find(d => pending.cards.every(c => d.cards.some(existing => C.fingerprint(c) === C.fingerprint(existing))));
      $('fcPreview').hidden = false;
      $('fcPreview').innerHTML = '<h3>' + html(pending.name) + '</h3><p>' + pending.cards.length + ' cards ready to save</p><details><summary>Preview the first card</summary><div class="fc-preview-card"><div id="fcPreviewFront"></div><div class="fc-card-label">Answer</div><div id="fcPreviewBack"></div></div></details><label for="fcImportTarget"' + (state.decks.length ? '' : ' hidden') + '>Save to<select id="fcImportTarget"><option value="">New deck</option>' + state.decks.map(d => '<option value="' + html(d.id) + '"' + (match?.id === d.id ? ' selected' : '') + '>Add to ' + html(d.name) + '</option>').join('') + '</select></label><div class="fc-actions"><button class="btn primary" data-fc="save-import">Save deck</button><small>Duplicates are skipped. Saved progress is kept.</small></div>';
      rich('fcPreviewFront', pending.cards[0].front); rich('fcPreviewBack', pending.cards[0].back);
    } catch (e) { pending = null; $('fcPreview').hidden = true; $('fcImportStatus').classList.add('fc-error'); $('fcImportStatus').textContent = e.message; }
  }
  function saveImport() {
    if (!pending) return;
    try {
      const target = state.decks.find(d => d.id === $('fcImportTarget').value);
      let next = copy(state), added;
      if (target) { const merged = C.mergeDeck(target, pending); next.decks = next.decks.map(d => d.id === target.id ? merged.deck : d); added = merged.added; }
      else { if (next.decks.length >= 500) throw new Error('Your library is full. Combine or remove a deck first.'); const d = C.createDeck(pending); next.decks.unshift(d); added = d.cards.length; }
      if (!save(next)) return;
      notice(added ? added + (added === 1 ? ' card saved.' : ' cards saved.') : 'These cards are already saved. Your review progress is unchanged.');
      pending = null; $('fcJson').value = ''; $('fcPreview').hidden = true; closeImport(); $('fcImportStatus').textContent = ''; renderLibrary();
    } catch (e) { notice(e.message, true); }
  }
  function loadImport() { if (!pending) preview(); if (pending) saveImport(); }
  function start(deck, mode, container) {
    if (!deck) return;
    const limit = mode === 'browse' ? C.MAX_CARDS : Number(container?.querySelector('[data-option=limit]')?.value || 20);
    const tag = container?.querySelector('[data-option=tag]')?.value || '';
    const queue = C.queue(deck, { mode, limit, tag, shuffle: !!container?.querySelector('[data-option=shuffle]')?.checked });
    if (!queue.length) { notice('No cards are ready in this topic. Try another topic or browse the deck. ' + dueLabel(deck) + '.'); return; }
    const session = { deckId: deck.id, mode, queue, cursor: 0, revealed: false, startedAt: Date.now(), ratings: { again: 0, hard: 0, good: 0, easy: 0 } };
    if (save({ ...state, session })) { undo = null; editor = false; $('fcNotice').hidden = true; render(); $('fcStudyTitle').setAttribute('tabindex', '-1'); $('fcStudyTitle').focus(); }
  }
  function renderStudy(animateFlip = false) {
    const s = state.session, deck = state.decks.find(d => d.id === s.deckId);
    if (!deck) { save({ ...state, session: null }); render(); return; }
    $('fcStudyTitle').textContent = deck.name;
    $('fcUndo').hidden = !undo;
    $('fcShortcuts').hidden = editor || s.cursor >= s.queue.length;
    $('fcShortcuts').textContent = s.mode === 'browse' ? 'Space to flip · ← → to browse · ? shortcuts' : 'Space to flip · 1–4 to rate · ? shortcuts';
    const browsing = s.mode === 'browse';
    $('fcStudyMeta').textContent = browsing ? 'Browse · scheduling stays unchanged' : (s.mode === 'all' ? 'Practice all' : 'Due + new') + ' · ' + s.cursor + ' of ' + s.queue.length + ' reviewed';
    if (s.cursor >= s.queue.length) {
      const reviewed = Object.values(s.ratings).reduce((a, b) => a + b, 0), n = C.counts(deck);
      $('fcStudyBody').innerHTML = '<div class="fc-complete">' + icon('target') + '<h2>One step stronger.</h2><p>You reviewed ' + reviewed + (reviewed === 1 ? ' card' : ' cards') + ' in this session. Your progress is saved.</p><div class="fc-badges">' + Object.entries(s.ratings).map(([k, v]) => '<span class="fc-badge">' + html(k[0].toUpperCase() + k.slice(1)) + ': ' + v + '</span>').join('') + '</div><p>' + html(dueLabel(deck)) + '.<br>' + (n.due + n.new ? n.due + ' due and ' + n.new + ' new cards remain.' : 'You’re caught up for now.') + '</p><div class="fc-actions">' + button('library', 'Back to decks') + button('continue', 'Review another set') + '</div></div>'; return;
    }
    const card = deck.cards.find(c => c.id === s.queue[s.cursor]);
    if (!card) { save({ ...state, session: null }); render(); return; }
    if (editor) {
      $('fcStudyBody').innerHTML = '<div class="fc-panel fc-editor"><h3>Edit this card</h3><p>Changing its meaning resets this card’s review schedule.</p><label for="fcEditFront">Front</label><textarea id="fcEditFront">' + html(card.front) + '</textarea><label for="fcEditBack">Back</label><textarea id="fcEditBack">' + html(card.back) + '</textarea><div class="fc-actions">' + button('save-edit', 'Save changes') + button('cancel-edit', 'Cancel') + '</div></div>'; return;
    }
    $('fcStudyBody').innerHTML = '<progress class="fc-progress" value="' + s.cursor + '" max="' + s.queue.length + '" aria-label="Session progress"></progress><article class="fc-review-card"><div class="fc-card-scene"><div class="fc-flip-card' + ((animateFlip ? !s.revealed : s.revealed) ? ' is-flipped' : '') + '"><div id="fcFrontPanel" class="fc-face fc-face-front" aria-hidden="' + s.revealed + '"' + (s.revealed ? ' inert' : '') + '><div class="fc-card-label">Question · ' + (s.cursor + 1) + ' / ' + s.queue.length + '</div><div id="fcFront" class="fc-front"></div></div>' +
      '<div id="fcBackPanel" class="fc-face fc-face-back" aria-hidden="' + !s.revealed + '"' + (!s.revealed ? ' inert' : '') + '><div class="fc-card-label">Answer · ' + (s.cursor + 1) + ' / ' + s.queue.length + '</div><div id="fcBack" class="fc-back-content"></div></div></div></div>' +
      '<div class="fc-flip-actions"><button class="btn' + (!s.revealed ? ' primary' : '') + '" data-fc="reveal" aria-controls="fcBackPanel" aria-expanded="' + s.revealed + '" title="Flip card (Space / Enter)">' + (s.revealed ? 'Show question' : 'Flip for answer') + '</button></div>' +
      (!browsing && s.revealed ? '<div class="fc-ratings" aria-label="How well did you recall it?">' + ['again', 'hard', 'good', 'easy'].map((r, i) => '<button class="btn fc-rating" data-fc="rate" data-rating="' + r + '" title="' + r + ' (' + (i + 1) + ')"><strong>' + r[0].toUpperCase() + r.slice(1) + '<kbd>' + (i + 1) + '</kbd></strong><small>' + duration(C.schedule(card.progress, r).interval) + '</small></button>').join('') + '</div>' : '') +
      (browsing ? '<div class="fc-browse-actions">' + button('previous', '← Previous', s.cursor === 0 ? 'disabled' : '') + '<details class="fc-card-menu"><summary>Card options</summary><div class="fc-actions">' + button('edit', 'Edit', 'title="Edit card (E)"') + button('delete-card', 'Delete card') + '</div></details>' + button('next', 'Next →', s.cursor === s.queue.length - 1 ? 'disabled' : '') + '</div>' : '') + '</article>';
    rich('fcFront', card.front);
    rich('fcBack', card.back);
    if (animateFlip) { const flip = $('fcStudyBody').querySelector('.fc-flip-card'); requestAnimationFrame(() => requestAnimationFrame(() => flip.classList.toggle('is-flipped', s.revealed))); }
  }
  function reveal() {
    if (!state.session || editor || state.session.cursor >= state.session.queue.length) return;
    if (save({ ...state, session: { ...state.session, revealed: !state.session.revealed } })) { renderStudy(true); $('fcStudyBody').querySelector('[data-fc=reveal]').focus({ preventScroll: true }); }
  }
  function rate(rating) {
    const s = state.session;
    if (!s || s.mode === 'browse' || !s.revealed || s.cursor >= s.queue.length) return;
    const next = copy(state), deck = next.decks.find(d => d.id === s.deckId), card = deck.cards.find(c => c.id === s.queue[s.cursor]);
    card.progress = C.schedule(card.progress, rating); deck.updatedAt = Date.now();
    next.session.cursor++; next.session.revealed = false; next.session.ratings[rating]++;
    const date = studyDateKey(Date.now());
    next.activity ||= [];
    const daily = next.activity.find(item => item.deckId === deck.id && item.date === date);
    if (daily) { daily.reviewed++; daily.name = deck.name; daily.updatedAt = new Date().toISOString(); }
    else next.activity.push({ deckId: deck.id, name: deck.name, date, reviewed: 1, updatedAt: new Date().toISOString() });
    next.activity = next.activity.slice(-730);
    const before = copy(state);
    if (save(next)) { undo = before; renderStudy(); const target = $('fcStudyBody').querySelector('[data-fc=reveal], [data-fc=library]'); target?.focus({ preventScroll: true }); const card = $('fcStudyBody').querySelector('.fc-review-card'); if (card && card.getBoundingClientRect().top < 80) card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  }
  function download(data, filename) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function clipboard(value) {
    try { await navigator.clipboard.writeText(value); notice('Copied. Paste it into your AI chat.'); }
    catch (_) { notice('Clipboard access is unavailable. The text is selected below so you can copy it manually.'); openImport(); $('fcJson').value = value; $('fcJson').select(); }
  }
  async function copyPrompt(btn) {
    if (btn) btn.disabled = true;
    try {
      const response = await fetch('flashcard-seed-prompt.txt');
      if (!response.ok) throw new Error('Prompt unavailable');
      const value = await response.text();
      try { await navigator.clipboard.writeText(value); toast('Flashcard prompt copied. Paste it into your AI chat.'); }
      catch (_) {
        const dialog = document.createElement('dialog');
        dialog.id = 'fcPromptCopyDialog'; dialog.className = 'fc-key-dialog';
        dialog.setAttribute('aria-labelledby', 'fcPromptCopyTitle');
        dialog.innerHTML = '<div class="fc-panel-heading"><h2 id="fcPromptCopyTitle">Copy flashcard prompt</h2><button class="btn" type="button">Close</button></div><p>Clipboard access is unavailable. Copy the selected text with Ctrl/Cmd+C.</p><textarea readonly aria-label="Flashcard generation prompt" style="width:100%;box-sizing:border-box;min-height:240px;padding:12px;font:inherit;background:var(--surface);color:var(--text);border:1px solid var(--line);border-radius:10px"></textarea>';
        const text = dialog.querySelector('textarea'); text.value = value;
        dialog.querySelector('button').onclick = () => dialog.close();
        dialog.addEventListener('close', () => { dialog.remove(); if (btn?.isConnected) btn.focus(); }, { once:true });
        document.body.append(dialog); dialog.showModal(); text.focus(); text.select();
      }
    } catch (_) { toast('The flashcard prompt could not be loaded. Try again.'); }
    finally { if (btn) btn.disabled = false; }
  }
  function handle(event) {
    const btn = event.target.closest('[data-fc]'); if (!btn || btn.disabled) return;
    const action = btn.dataset.fc, container = btn.closest('[data-deck]'), deck = state.decks.find(d => d.id === container?.dataset.deck);
    if (action === 'help') $('fcKeyDialog').showModal();
    else if (action === 'close-help') $('fcKeyDialog').close();
    else if (action === 'open-import') openImport();
    else if (action === 'close-import') closeImport();
    else if (action === 'example') { openImport(); $('fcJson').value = JSON.stringify(example, null, 2); preview(); }
    else if (action === 'copy-prompt') copyPrompt(btn);
    else if (action === 'copy-schema') clipboard(JSON.stringify({ name: 'My topic', cards: [{ front: 'A question?', back: 'The answer, with a short explanation.', tags: ['topic'] }] }, null, 2));
    else if (action === 'preview') preview();
    else if (action === 'load-import') loadImport();
    else if (action === 'save-import') saveImport();
    else if (action === 'start') start(deck, btn.dataset.mode, container);
    else if (action === 'library') { if (save({ ...state, session: null })) { undo = null; editor = false; render(); $('flashcardsView').querySelector('.fc-heading [data-fc=open-import]').focus({ preventScroll: true }); } }
    else if (action === 'reveal') reveal();
    else if (action === 'rate') rate(btn.dataset.rating);
    else if (action === 'undo' && undo) { if (save(undo)) { undo = null; renderStudy(); notice('Last rating undone.'); } }
    else if (action === 'continue') start(state.decks.find(d => d.id === state.session.deckId), 'due');
    else if (action === 'export' && deck) { download({ name: deck.name, ...(deck.description ? { description: deck.description } : {}), cards: deck.cards.map(({ front, back, tags }) => ({ front, back, tags })) }, deck.name.replace(/[^a-z0-9_-]/gi, '-').slice(0, 80) + '.json'); notice('Deck exported. Use the app backup in Settings to also export review progress.'); }
    else if (action === 'delete' && deck && confirm('Delete “' + deck.name + '” and its review progress? Export a copy first if you want to keep it.')) { if (save({ ...state, decks: state.decks.filter(d => d.id !== deck.id) })) renderLibrary(); }
    else if (action === 'rename' && deck) {
      const name = prompt('Deck name', deck.name); if (!name?.trim()) return;
      if (name.trim().length > 160) { notice('Use a name under 160 characters.', true); return; }
      if (save({ ...state, decks: state.decks.map(d => d.id === deck.id ? { ...d, name: name.trim() } : d) })) renderLibrary();
    }
    else if ((action === 'previous' || action === 'next') && state.session?.mode === 'browse') {
      const cursor = state.session.cursor + (action === 'next' ? 1 : -1);
      if (cursor >= 0 && cursor < state.session.queue.length && save({ ...state, session: { ...state.session, cursor, revealed: false } })) renderStudy();
    }
    else if (action === 'edit') { editor = true; renderStudy(); $('fcEditFront').focus(); }
    else if (action === 'cancel-edit') { editor = false; renderStudy(); }
    else if (action === 'save-edit') {
      try {
        const next = copy(state), s = next.session, d = next.decks.find(d => d.id === s.deckId), card = d.cards.find(c => c.id === s.queue[s.cursor]);
        const content = C.normalizeCard({ front: $('fcEditFront').value, back: $('fcEditBack').value, tags: card.tags }, 0);
        if (d.cards.some(c => c.id !== card.id && C.fingerprint(c) === C.fingerprint(content))) throw new Error('This card is already in your deck.');
        if (C.fingerprint(content) !== C.fingerprint(card)) card.progress = C.freshProgress();
        Object.assign(card, content); d.updatedAt = Date.now();
        if (save(next)) { editor = false; undo = null; renderStudy(); notice('Card saved.'); }
      } catch (e) { notice(e.message, true); }
    }
    else if (action === 'delete-card' && confirm('Delete this card and its review progress?')) {
      const next = copy(state), s = next.session, d = next.decks.find(d => d.id === s.deckId), cardId = s.queue[s.cursor];
      d.cards = d.cards.filter(c => c.id !== cardId); s.queue = s.queue.filter(id => id !== cardId); s.cursor = Math.min(s.cursor, s.queue.length - 1); s.revealed = false;
      if (!d.cards.length) { next.decks = next.decks.filter(deck => deck.id !== d.id); next.session = null; }
      else if (!s.queue.length) next.session = null;
      if (save(next)) { undo = null; render(); notice('Card deleted.'); }
    }
  }
  function saveQuestion(q, sourceName) {
    try {
      read();
      const { front, back } = CBQQuestionCard.content(q);
      const parsed = C.parse(JSON.stringify({ name: 'Saved quiz explanations', cards: [{ front, back, tags: [String(sourceName || 'CBQ').slice(0, 60)] }] }));
      const next = copy(state), existing = next.decks.find(d => d.name === parsed.name);
      let added = 1;
      if (existing) { const merged = C.mergeDeck(existing, parsed); added = merged.added; next.decks = next.decks.map(d => d.id === existing.id ? merged.deck : d); }
      else { if (next.decks.length >= 500) throw new Error('The flashcard library is full. Remove or combine a deck first.'); next.decks.unshift(C.createDeck(parsed)); }
      if (save(next)) { undo = null; toast(added ? 'Saved to Flashcards → Saved quiz explanations' : 'This flashcard is already saved'); return true; }
      toast('Could not save the flashcard. Check browser storage.');
    } catch (e) { toast('Flashcard not saved: ' + e.message); }
    return false;
  }
  function handleKey(e) {
    if ($('fcPromptCopyDialog')?.open) return true;
    if (!$('flashcardsView').classList.contains('active') || e.defaultPrevented) return false;
    const key = e.key, lower = key.toLowerCase(), typing = e.target.closest('input, textarea, select, [contenteditable=true]');
    const invoke = action => { $('flashcardsView').querySelector('[data-fc="' + action + '"]')?.click(); };
    const consume = action => { e.preventDefault(); action(); return true; };
    if ($('fcKeyDialog').open) return key === 'Escape' ? consume(() => $('fcKeyDialog').close()) : true;
    if (key === 'Escape') {
      if (editor) return consume(() => { editor = false; renderStudy(); $('fcStudyTitle').focus(); });
      if (!$('fcImport').hidden) return consume(closeImport);
      return false;
    }
    if (e.repeat) return false;
    if ((e.ctrlKey || e.metaKey) && key === 'Enter' && !e.altKey && !e.shiftKey) {
      if (editor) return consume(() => invoke('save-edit'));
      if (!$('fcImport').hidden) return consume(loadImport);
      return consume(() => { openImport(); if ($('fcJson').value.trim()) loadImport(); });
    }
    if (typing) return false;
    if ((e.ctrlKey || e.metaKey) && lower === 'z' && !e.shiftKey && undo) return consume(() => invoke('undo'));
    if (e.ctrlKey || e.metaKey || e.altKey || (e.shiftKey && key !== '?')) return false;
    if (key === '?') return consume(() => $('fcKeyDialog').showModal());
    if (editor) return false;
    if (!state.session) {
      if (lower === 'n') return consume(openImport);
      if (lower === 'c') return consume(() => $('flashcardsView').querySelector('.fc-heading [data-fc=copy-schema]').click());
      return false;
    }
    if (lower === 'b') return consume(() => invoke('library'));
    if (lower === 'u' && undo) return consume(() => invoke('undo'));
    const s = state.session;
    if (s.cursor >= s.queue.length) return false;
    if ((key === ' ' || key === 'Enter')) {
      if (e.target.closest('button, summary, a') && e.target.closest('button')?.dataset.fc !== 'reveal') return false;
      return consume(reveal);
    }
    if (s.mode !== 'browse' && s.revealed && /^[1-4]$/.test(key)) return consume(() => rate(['again', 'hard', 'good', 'easy'][Number(key) - 1]));
    if (s.mode === 'browse') {
      if (key === 'ArrowLeft' || key === 'ArrowRight') return consume(() => invoke(key === 'ArrowLeft' ? 'previous' : 'next'));
      if (lower === 'e') return consume(() => invoke('edit'));
    }
    return false;
  }
  window.Flashcards = { refresh, saveQuestion, copyPrompt, handleKey, validateBackup: C.validateStore };
  document.addEventListener('DOMContentLoaded', () => {
    $('flashcardsView').addEventListener('click', handle);
    $('fcJson').addEventListener('input', () => { pending = null; $('fcPreview').hidden = true; $('fcImportStatus').textContent = ''; });
    $('fcFile').addEventListener('change', async event => {
      const file = event.target.files?.[0]; if (!file) return;
      try { if (file.size > 4000000) throw new Error('Choose a JSON file under 4 MB.'); $('fcJson').value = await file.text(); preview(); }
      catch (e) { notice(e.message, true); } finally { event.target.value = ''; }
    });
    window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) { refresh(); notice('Your flashcards were updated in another tab.'); } });
    // Update due counts while the library is open, without interrupting its controls.
    setInterval(() => {
      if (!$('flashcardsView').classList.contains('active') || state.session) return;
      const sums = state.decks.reduce((n, d) => { const c = C.counts(d); n[0] += c.due; n[1] += c.new; n[2] += d.cards.length; return n; }, [0, 0, 0]);
      $('fcStats').querySelectorAll('strong').forEach((el, i) => el.textContent = sums[i]);
      $('fcDecks').querySelectorAll('[data-deck]').forEach(el => { const d = state.decks.find(d => d.id === el.dataset.deck); if (!d) return; const c = C.counts(d); el.querySelector('.fc-deck-counts').textContent = c.due + ' due · ' + c.new + ' new · ' + d.cards.length + ' cards'; });
    }, 30000);
  });
})();
