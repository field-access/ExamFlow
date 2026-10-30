import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const views = path.join(root, 'views');

async function render(file, ancestors = []) {
  const target = path.resolve(views, file);
  if (!target.startsWith(views + path.sep) || ancestors.includes(target)) {
    throw new Error(`Invalid or circular template include: ${file}`);
  }
  const source = await readFile(target, 'utf8');
  const includes = [...source.matchAll(/<!-- include: ([\w/.-]+) -->/g)];
  let output = source;
  for (const include of includes) {
    output = output.replace(include[0], await render(include[1], [...ancestors, target]));
  }
  return output;
}

const html = await render('index.html');
const output = path.join(root, 'public');
await mkdir(output, { recursive: true });
await writeFile(path.join(root, 'index.html'), html);
await writeFile(path.join(output, 'index.html'), html);
for (const asset of ['app.js', 'styles.css', 'original-prompts.json', 'seed-prompts.json', 'flashcard-seed-prompt.txt', 'css', 'js']) {
  await cp(path.join(root, asset), path.join(output, asset), { recursive: true });
}
console.log('Built index.html and static assets in public/');
