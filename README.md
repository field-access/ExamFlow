# ExamFlow

Static exam and practice app. Serve this folder over HTTP so the prompt JSON loads automatically.

## Editing the interface

Edit `views/index.html`, `views/settings.html`, and the HTML partials in `views/partials/`.
Run `npm run build` to regenerate `index.html` and the deployable `public/` folder. The template build uses Node's
built-in modules and requires no dependencies. Keep the generated file checked in.

The prompt library has its own scoped stylesheet at `css/prompt-library.css`.
Its markup deliberately avoids the compact settings-row and global sidebar classes.
Theme colors and gradients are defined in `css/themes.css`.
Interface sizing is in `css/interface.css`; the home study calendar and cards use
`js/study-dashboard.js` and `css/study-dashboard.css`. Study activity is backed up
alongside sessions and results, and included in data exports.
Button hierarchy and icon accents are maintained in `css/controls.css`.
Default seed prompts live in `seed-prompts.json`. Settings saves custom slots and drafts in the browser.

## Flashcards

Open **Flashcards → Add a deck** to paste JSON or import a file. Copy the generation prompt or try the sample deck from the importer. The seed prompt is editable in `flashcard-seed-prompt.txt`.

```json
{"name":"My topic","cards":[{"front":"Why does this work?","back":"A short answer and explanation.","tags":["reasoning"]}]}
```

Import previews validate every card before saving. Adding to a saved deck skips exact front/back duplicates and preserves review progress. Markdown and LaTeX are supported; escape LaTeX backslashes in JSON. Browse and practice-all preserve source order unless shuffled.

Review due and new cards in small sessions. Flip between question and answer with Space, Enter, or the flip button, then rate Again, Hard, Good or Easy with keys 1–4. New cards return in 1 minute, 10 minutes, 1 day or 4 days respectively. Successful later reviews increase the interval; Again returns a card to learning. A card appears once per session, and overdue reviews come before new cards. Browse does not change scheduling. Editing a card's content resets its schedule. Reduced-motion preferences disable the flip animation.

Deck session settings and management are under **Options**. Press **?** for shortcut help, **U** to undo a rating, **B** to return to decks, **N** to add a deck, and **C** to copy the schema from the library. In Browse, use the arrow keys to move and **E** to edit. Ctrl/Cmd+Enter opens the importer from the library, loads pasted JSON in one press, or saves card edits; text fields retain normal typing and undo behavior.

Ratings save immediately; returning to the page or reloading resumes the active session. Undo reverses the most recent rating in the current visit. Quiz practice answers and completed result reviews have a **Save as flashcard** button for a shared explanations deck. Review activity appears in the home study calendar.

Press **F** to save a revealed/verified practice question or the selected question in completed results. The shortcut does not interrupt text entry. Navigation follows page order: **Alt+1** Home, **Alt+2** Exam, **Alt+3** Flashcards, **Alt+4** Plan, **Alt+5** Settings.

Data is stored in this browser, included in persistent recovery and Settings data backups. Deck export contains portable content; the full app export also includes scheduling and activity. There is no account or automatic cross-device sync.

Continue studying offers **Flashcard preview** when a saved CBQ has marked questions or confirmed mistakes. Filter by All to review, Marked, or Mistakes; overlapping questions appear once in source order. Practice mistakes require a verified answer; unanswered questions are not mistakes. Completed results also offer previews through the study calendar. Unsubmitted Exam sessions keep answers hidden until submission. Flip with Space/Enter, browse with arrows, and close with Escape. This temporary preview creates no deck, saves no ratings or scheduling, and leaves quiz answers and review marks unchanged. Closing discards the preview position.

The page uses `views/flashcards.html`, `css/flashcards.css`, and `js/flashcards.js`. The pure data/scheduling module is `js/flashcards-core.js`. Run `npm test`; see `tests/README.md` for browser checks.

## Deploying

Vercel runs `npm run build` and serves `public/`, as configured in `vercel.json`.
The build copies the generated page, JavaScript, stylesheets, and prompt library into that folder.
For a local deployment preview, run `python -m http.server 8000 --directory public` after building.
