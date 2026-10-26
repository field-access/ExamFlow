/* Read-only CBQ review. The queue and flip state live only for this dialog visit. */
(() => {
  const $ = id => document.getElementById(id);
  let state = null, returnFocus = null;
  function content(q) {
    let answer;
    if (q.type === 'fill_blank') answer = (q.acceptedAnswers || [q.answer]).join(' / ');
    else if (q.type === 'match' || q.type === 'drag_drop') answer = (q.pairs || []).map(p => p.left + ' → ' + p.right).join('\n');
    else if (q.type === 'ordering') answer = (q.answer || []).map((v, i) => (i + 1) + '. ' + v).join('\n');
    else answer = q.options?.[getCorrectOptionIndex(q)] ?? String(q.answer ?? '');
    const items = Array.isArray(q.pairs) && q.pairs.length
      ? '\n\n' + q.pairs.map(p => '- ' + p.left).join('\n')
      : Array.isArray(q.options) && q.options.length
        ? '\n\n' + q.options.map((o, i) => String.fromCharCode(65 + i) + '. ' + o).join('\n') : '';
    return { front: String(q.text || '') + items, answer,
      back: '**Answer:** ' + answer + (q.explanation ? '\n\n**Explanation:**\n' + q.explanation : '') };
  }
  function valid(q) {
    if (!q || typeof q !== 'object' || !String(q.text || '').trim()) return false;
    if (q.type === 'fill_blank') return Array.isArray(q.acceptedAnswers) && q.acceptedAnswers.some(a => String(a ?? '').trim());
    if (q.type === 'match' || q.type === 'drag_drop') return Array.isArray(q.pairs) && q.pairs.length > 0 && q.pairs.every(p => p && p.left != null && p.right != null);
    if (q.type === 'ordering') return Array.isArray(q.answer) && q.answer.length > 0;
    const index = getCorrectOptionIndex(q);
    return Array.isArray(q.options) && index >= 0 && index < q.options.length;
  }
  function inspect(source, completed = false) {
    const questions = Array.isArray(source?.questions) ? source.questions : [];
    const marked = new Set(Array.isArray(source?.reviews) ? source.reviews.filter(Number.isInteger) : []);
    const checked = new Set(Array.isArray(source?.checkedQuestions) ? source.checkedQuestions.filter(Number.isInteger) : []);
    const allowed = completed || source?.examFinished === true || source?.mode === 'practice';
    let markedCount = 0;
    const cards = [];
    questions.forEach((q, index) => {
      if (!valid(q)) return;
      const review = marked.has(index);
      if (review) markedCount++;
      if (!allowed) return;
      const answer = source.answers?.[index];
      const mistake = (completed || source.examFinished === true || checked.has(index)) && answerIsPresent(answer, q) && !isQuestionCorrect(q, answer);
      if (review || mistake) cards.push({ q, index, review, mistake, selected: answer });
    });
    return { allowed, marked: markedCount, mistakes: cards.filter(c => c.mistake).length, cards };
  }
  function controls(source, kind) {
    if (!source) return '';
    const info = inspect(source, kind === 'result');
    if (!info.allowed) return info.marked ? '<p class="study-review-note">' + info.marked + ' marked · Flashcard preview available after submission</p>' : '';
    if (!info.cards.length) return '';
    return '<div class="study-review-actions"><button class="btn" type="button" data-cbq-preview="' + esc(kind) + '" data-source-id="' + esc(source.id) + '"><svg class="ui-icon"><use href="#icon-bookmark"/></svg>Flashcard preview <span>' + info.cards.length + '</span></button><small>' + info.marked + ' marked · ' + info.mistakes + ' mistakes</small></div>';
  }
  function queue() { return state.cards.filter(c => state.filter === 'all' || (state.filter === 'marked' ? c.review : c.mistake)); }
  function rich(id, text) { setQuizRichText($(id), text, { literalNewlines: false }); renderAllQuizMath($(id)); }
  function selectedText(card) {
    const { q, selected } = card;
    if (q.type === 'match' || q.type === 'drag_drop') return q.pairs.map((p, i) => p.left + ' → ' + selected[i]).join('\n');
    if (Array.isArray(selected)) return selected.map((v, i) => (i + 1) + '. ' + v).join('\n');
    if (q.type === 'fill_blank') return String(selected);
    const index = /^[A-Z]$/i.test(String(selected)) ? String(selected).toUpperCase().charCodeAt(0) - 65 : -1;
    return String(q.options?.[index] ?? selected);
  }
  function render() {
    const cards = queue(), card = cards[state.cursor];
    const complete = !card && cards.length > 0;
    $('cbqPreviewTitle').textContent = state.name;
    $('cbqPreviewFilters').innerHTML = [['all', 'All to review', state.cards.length], ['marked', 'Marked', state.cards.filter(c => c.review).length], ['mistakes', 'Mistakes', state.cards.filter(c => c.mistake).length]].map(([key, label, count]) => '<option value="' + key + '">' + label + ' (' + count + ')</option>').join('');
    $('cbqPreviewFilters').value = state.filter;
    $('cbqPreviewProgress').textContent = card ? 'Preview · ' + (state.cursor + 1) + ' / ' + cards.length : complete ? 'Preview complete' : 'No questions in this group';
    $('cbqPreviewBody').hidden = !card;
    $('cbqPreviewEmpty').hidden = !!card;
    $('cbqPreviewEmpty').textContent = complete ? 'You reached the end. Review again, or return to your quiz.' : 'No eligible questions here. Try another group.';
    $('cbqPreviewRestart').hidden = !complete;
    $('cbqPreviewFlip').hidden = !card;
    $('cbqPreviewPrevious').disabled = !cards.length || state.cursor === 0;
    $('cbqPreviewNext').hidden = !card;
    $('cbqPreviewNext').textContent = state.cursor === cards.length - 1 ? 'Done' : '→';
    if (!card) return;
    state.revealed = false;
    const value = content(card.q);
    rich('cbqPreviewFront', value.front);
    rich('cbqPreviewBack', value.back);
    $('cbqPreviewSelected').hidden = !card.mistake;
    if (card.mistake) rich('cbqPreviewSelected', '**Your answer:**\n' + selectedText(card));
    const image = $('cbqPreviewImage'), src = typeof card.q.image === 'string' ? card.q.image.trim() : '';
    image.hidden = true;
    image.removeAttribute('src');
    if (/^(https?:\/\/|data:image\/(png|jpeg|gif|webp);base64,)/i.test(src)) { image.src = src; image.hidden = false; }
    // A new question starts on its front; only explicit flips animate.
    const flipCard = $('cbqPreviewCard');
    flipCard.style.transition = 'none';
    updateFlip();
    void flipCard.offsetHeight;
    flipCard.style.removeProperty('transition');
  }
  function updateFlip() {
    $('cbqPreviewCard').classList.toggle('is-flipped', state.revealed);
    $('cbqPreviewFrontPanel').inert = state.revealed;
    $('cbqPreviewBackPanel').inert = !state.revealed;
    $('cbqPreviewFrontPanel').setAttribute('aria-hidden', String(state.revealed));
    $('cbqPreviewBackPanel').setAttribute('aria-hidden', String(!state.revealed));
    $('cbqPreviewFlip').textContent = state.revealed ? 'Show question' : 'Show answer';
    $('cbqPreviewFlip').setAttribute('aria-pressed', String(state.revealed));
  }
  function flip() { if (state && queue()[state.cursor]) { state.revealed = !state.revealed; updateFlip(); } }
  function move(delta) {
    const next = Math.max(0, Math.min(queue().length, state.cursor + delta));
    if (next === state.cursor) return;
    state.cursor = next;
    render();
    if ($('cbqPreviewNext').hidden) $('cbqPreviewRestart').focus();
    else if (document.activeElement === $('cbqPreviewRestart')) $('cbqPreviewFlip').focus();
  }
  function open(kind, id) {
    const source = get(kind === 'result' ? K.results : K.sessions, []).find(s => s.id === id);
    if (!source) { toast('This saved quiz is no longer available.'); renderDashboard(); return; }
    const info = inspect(source, kind === 'result');
    if (!info.allowed) { toast('Answer preview is available after Exam submission.'); return; }
    if (!info.cards.length) { toast('No marked questions or verified mistakes to preview.'); renderDashboard(); return; }
    returnFocus = document.activeElement;
    state = { name: source.name || 'CBQ review', cards: cloneData(info.cards), cursor: 0, filter: 'all', revealed: false };
    render();
    $('cbqPreviewDialog').showModal();
    $('cbqPreviewFlip').focus();
  }
  function handleKey(e) {
    if (!$('cbqPreviewDialog')?.open) return false;
    // Keep page shortcuts from operating on the quiz or a saved deck behind the dialog.
    if (e.key === 'Escape') { e.preventDefault(); $('cbqPreviewDialog').close(); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat || e.target.closest('input, textarea, select, [contenteditable=true]')) return true;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); move(e.key === 'ArrowLeft' ? -1 : 1); }
    else if ((e.key === ' ' || e.key === 'Enter') && (!e.target.closest('button, a, summary') || e.target.id === 'cbqPreviewFlip')) { e.preventDefault(); flip(); }
    return true;
  }
  window.CBQQuestionCard = { content };
  window.CBQReviewPreview = { controls, handleKey };
  document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', e => {
      const button = e.target.closest('[data-cbq-preview]');
      if (button) open(button.dataset.cbqPreview, button.dataset.sourceId);
    });
    $('cbqPreviewDialog').addEventListener('click', e => {
      const button = e.target.closest('button');
      if (!button || !state) return;
      if (button.id === 'cbqPreviewClose') $('cbqPreviewDialog').close();
      else if (button.id === 'cbqPreviewFlip') flip();
      else if (button.id === 'cbqPreviewPrevious') move(-1);
      else if (button.id === 'cbqPreviewNext') move(1);
      else if (button.id === 'cbqPreviewRestart') { state.cursor = 0; render(); $('cbqPreviewFlip').focus(); }
    });
    $('cbqPreviewFilters').addEventListener('change', e => {
      if (!state || !['all', 'marked', 'mistakes'].includes(e.target.value)) return;
      state.filter = e.target.value; state.cursor = 0; render();
    });
    $('cbqPreviewDialog').addEventListener('close', () => {
      state = null;
      for (const id of ['cbqPreviewFront', 'cbqPreviewBack', 'cbqPreviewSelected']) $(id).replaceChildren();
      $('cbqPreviewImage').removeAttribute('src');
      if (returnFocus?.isConnected) returnFocus.focus();
      returnFocus = null;
    });
    $('cbqPreviewImage').addEventListener('error', () => { $('cbqPreviewImage').hidden = true; });
    window.addEventListener('quizflow-library-change', e => { if(state && e.detail.keys.some(key=>key===K.sessions||key===K.results)){ $('cbqPreviewDialog').close();toast('Saved quizzes changed in another tab. Open the preview again.')} });
    window.addEventListener('storage', e => {
      if (state && (e.key === null || e.key === K.sessions || e.key === K.results)) { $('cbqPreviewDialog').close(); toast('Saved quizzes changed in another tab. Open the preview again to refresh.'); }
    });
  });
})();
