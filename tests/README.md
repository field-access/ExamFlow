Run the parser, scheduler, queue and backup tests with `npm test`.

The optional browser smoke test requires Playwright and Google Chrome. Build with `npm run build`, serve `public/` on port 8765, then run `node tests/flashcards-browser.cjs`. If Playwright is supplied by a shared runtime, set `EXAMFLOW_PLAYWRIGHT` to its module directory. Set `EXAMFLOW_TEST_URL` to use a different local server. Screenshots are written to `test-results/`.

The browser test uses isolated browser storage and blocks remote fonts and math libraries, so it checks preserved LaTeX source rather than KaTeX's rendered output.
