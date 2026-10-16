import { readFile, writeFile } from 'node:fs/promises';
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

await writeFile(path.join(root, 'index.html'), await render('index.html'));
console.log('Built index.html from views/');
