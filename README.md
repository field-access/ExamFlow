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
Default seed prompts live in `seed-prompts.json`. Settings saves custom slots and drafts in the browser.

## Deploying

Vercel runs `npm run build` and serves `public/`, as configured in `vercel.json`.
The build copies the generated page, JavaScript, stylesheets, and prompt library into that folder.
For a local deployment preview, run `python -m http.server 8000 --directory public` after building.
