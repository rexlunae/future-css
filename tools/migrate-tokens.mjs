/** Explicit rename maps keep future migrations reviewable and dependency-free. */
import { readFile, writeFile, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function migrateNames(source, renames) {
  const entries = Object.entries(renames);
  for (const [from, to] of entries) {
    if (!/^(?:--)?fc-[a-z0-9][a-z0-9_-]*$/.test(from) || typeof to !== 'string' || !/^(?:--)?fc-[a-z0-9][a-z0-9_-]*$/.test(to)) {
      throw new Error('Rename maps accept only fc- classes and --fc- tokens');
    }
    if (from.startsWith('--') !== to.startsWith('--')) throw new Error('Cannot rename a token into a class or vice versa');
  }
  let count = 0;
  if (!entries.length) return { source, count };
  // One pass prevents A→B, B→C from accidentally applying twice to A.
  const pattern = new RegExp(`(?<![\\w-])(?:${entries.map(([from]) => from).sort((a,b)=>b.length-a.length).join('|')})(?![\\w-])`, 'g');
  const migrated = source.replace(pattern, from => {count++; return renames[from];});
  return {source: migrated, count};
}

async function main(args) {
  const write = args.includes('--write');
  const mapIndex = args.indexOf('--map');
  if (mapIndex < 0 || !args[mapIndex + 1]) throw new Error('Usage: node tools/migrate-tokens.mjs --map renames.json [--write] file.css ...');
  const mapPath = args[mapIndex + 1];
  const files = args.filter((_, i) => i !== mapIndex && i !== mapIndex + 1).filter(a => a !== '--write');
  if (!files.length || files.some(f => f.startsWith('--'))) throw new Error('Provide explicit source files; unknown options are rejected');
  const renames = JSON.parse(await readFile(mapPath, 'utf8'));
  if (!renames || typeof renames !== 'object' || Array.isArray(renames)) throw new Error('Rename map must be an object');
  const prepared = await Promise.all([...new Set(files)].map(async file => ({file, ...migrateNames(await readFile(file, 'utf8'), renames)})));
  if (write) {
    for (const item of prepared.filter(p => p.count)) {
      try { await access(`${item.file}.fc-migration.bak`); throw new Error(`Backup already exists: ${item.file}.fc-migration.bak`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    for (const item of prepared.filter(p => p.count)) {
      await copyFile(item.file, `${item.file}.fc-migration.bak`, constants.COPYFILE_EXCL);
      await writeFile(item.file, item.source);
    }
  }
  for (const item of prepared) console.log(`${write ? 'updated' : 'dry run'}: ${item.file} (${item.count} replacements)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
