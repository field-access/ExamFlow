# QuizFlow

## Local library

Quizzes, results, sessions, prompt slots, planner data and flashcards now use IndexedDB as the primary store. A memory cache keeps the existing interface responsive; growing libraries no longer need to fit in localStorage. The first launch migrates legacy browser data and eligible recovery snapshots, committing the new database before removing old cache entries. Existing backup snapshots are retained for recovery but are no longer rewritten on every answer.

Settings → Local data shows library size, quiz/flashcard counts, browser usage and capacity, and saving status. Protect browser storage requests persistent storage; browsers decide whether to grant it. Retry saving retries pending writes. If a save fails, the app keeps the latest data in memory and shows an error: keep the tab open and export JSON before freeing space. JSON imports commit their included collections in one transaction. Exports include prompt slots and planner metadata as well as the existing portable quiz/deck fields, and never include API keys.

IndexedDB remains tied to the browser profile and site address. Clearing site data can delete the library. Keep regular JSON backups, particularly before changing browsers or URLs. Delete redundant sessions or decks through their existing controls when needed; the app never automatically discards study content. This storage change improves capacity and durability but does not add cloud synchronization.

The primary adapter is js/library-storage.js, with CSS in css/library-storage.css.

## Generate quizzes with AI

Open **Generate** (Alt/Option+7) to use **Gemini, OpenAI or Claude**. Choose the provider, paste its API key and click **Connect** to fetch the available supported models. Choose a saved CBQ prompt, enter a topic or source, and select a question count or follow the prompt. Settings still manages the prompt slots; default prompts remain in separate project files.

Get keys from [Google AI Studio](https://aistudio.google.com/apikey), [OpenAI](https://platform.openai.com/api-keys), or [Anthropic](https://platform.claude.com/settings/keys). Each provider has separate key storage and model preferences. **Remember key on this device** is optional: it stores the key without encryption in this browser's localStorage. Keys are excluded from quiz exports, library backups and IndexedDB records, and the server forwards them to the selected provider without saving or logging them. **Forget key** removes that provider's saved key. A saved key must be connected again after reloading.

Gemini's **Free-tier models only** filter uses the published eligibility catalog in `gemini-models.json`; eligibility does not guarantee available quota or free requests on a paid project. OpenAI and Claude use API credits: ChatGPT and Claude subscriptions do not include API usage. Claude lists models supporting structured JSON output and prefers Haiku when available. Check provider pricing and account limits before generating.

Generation runs only when requested, with no automatic retries. Connecting fetches model metadata; studying saved quizzes or flashcards makes no AI calls. Generated JSON is validated and previewed before **Open quiz** loads it through the existing importer. You can edit or download it first. New Exam attempts start their timer automatically; restored sessions preserve their saved timer state. Ctrl/Cmd+Enter connects from the key field, generates from the source, or opens the quiz from the JSON editor. Escape cancels a pending request.

Run `npm run dev` in a normal terminal in this project, then open [http://127.0.0.1:3000](http://127.0.0.1:3000). This builds the app and serves both study pages and the same-origin `/api/gemini`, `/api/openai`, and `/api/claude` endpoints. Opening `index.html` directly or using a static-only server cannot run generation. The server needs outbound HTTPS access to the selected provider; a server started in a restricted coding sandbox may be denied access. Vercel deploys the API functions alongside `public/`.

On Mac, use **Option+1–7** for page navigation, **Option+I** to import a quiz, **Option+M** for the mobile menu, **Option+X** to export, and **Option+S** to save the current session. **Cmd+Enter** loads pasted quizzes/decks or saves flashcard edits; **Cmd+Z** undoes a flashcard rating. Option shortcuts use physical key codes so macOS symbols do not break navigation. Shortcut help displays Mac labels automatically. Windows/Linux retain Alt navigation and Ctrl actions; standard browser shortcuts remain available.

Continue studying includes a keyword search across saved quiz titles and question content. Choose Title & content, Title only, or Content only. Multiple keywords must all match; matching titles come first. Searching without a calendar date includes prior loaded quizzes and completed results, preferring a resumable session for each quiz. A selected date limits the search to that day's history. Questions, options, matching prompts, sections and hints are searchable; explanations are searchable for Practice/completed work. Unsubmitted Exam explanations and correct answers stay hidden. Clear the search to return to in-progress sessions. **Option+F** on Mac / **Alt+F** elsewhere opens this search.

Quiz and practice pages can run on a static HTTP server; AI generation requires the app server or a Vercel deployment.

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

Deck session settings and management are under **Options**. Press **?** for shortcut help, **U** to undo a rating, **B** to return to decks, **N** to add a deck, and **C** to copy the schema from the library. In Browse, use the arrow keys to move and **E** to edit. Ctrl/Cmd+Enter opens the importer, pastes the latest clipboard JSON and loads the deck in one press, or saves card edits; text fields retain normal typing and undo behavior.

Ratings save immediately; returning to the page or reloading resumes the active session. Undo reverses the most recent rating in the current visit. Quiz practice answers and completed result reviews have a **Save as flashcard** button for a shared explanations deck. Review activity appears in the home study calendar.

Press **F** to save a revealed/verified practice question or the selected question in completed results. The shortcut does not interrupt text entry. Navigation follows page order: **Alt+1** Home, **Alt+2** Quiz, **Alt+3** Flashcards, **Alt+4** Plan, **Alt+5** Settings.

Data is stored in this browser, included in persistent recovery and Settings data backups. Deck export contains portable content; the full app export also includes scheduling and activity. There is no account or automatic cross-device sync.

Continue studying offers **Flashcard preview** when a saved CBQ has marked questions or confirmed mistakes. Filter by All to review, Marked, or Mistakes; overlapping questions appear once in source order. Practice mistakes require a verified answer; unanswered questions are not mistakes. Completed results also offer previews through the study calendar. Unsubmitted Exam sessions keep answers hidden until submission. Flip with Space/Enter, browse with arrows, and close with Escape. This temporary preview creates no deck, saves no ratings or scheduling, and leaves quiz answers and review marks unchanged. Closing discards the preview position.

The page uses `views/flashcards.html`, `css/flashcards.css`, and `js/flashcards.js`. The pure data/scheduling module is `js/flashcards-core.js`. Run `npm test`; see `tests/README.md` for browser checks.

## Deploying

Vercel runs `npm run build` and serves `public/`, as configured in `vercel.json`.
The build copies the generated page, JavaScript, stylesheets, and prompt library into that folder. Vercel also deploys the functions in `api/`; API keys are supplied per request, so no shared server key is required.
For a local preview including AI generation, run `npm run dev`. For a static study-page preview, run `python -m http.server 8000 --directory public` after building; this does not serve the API endpoints.
