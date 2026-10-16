# ExamFlow

Static exam and practice app. Serve this folder over HTTP so the prompt JSON loads automatically.

## Editing the interface

Edit `views/index.html`, `views/settings.html`, and the HTML partials in `views/partials/`.
Run `npm run build` to regenerate the deployable `index.html`. The template build uses Node's
built-in modules and requires no dependencies. Keep the generated file checked in.

The prompt library has its own scoped stylesheet at `css/prompt-library.css`.
Its markup deliberately avoids the compact settings-row and global sidebar classes.
Default seed prompts live in `seed-prompts.json`. Settings saves custom slots and drafts in the browser.
