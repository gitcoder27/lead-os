const fs = require('fs');
const path = require('path');
const { gzipSync } = require('zlib');
const root = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(root, '.vite/manifest.json')));
for (const target of ['index.html', 'src/components/team-tracker/TeamTrackerPage.tsx']) {
  const seen = new Set();
  const visit = key => { if (seen.has(key)) return; seen.add(key); for (const dep of manifest[key]?.imports ?? []) visit(dep); };
  visit(target);
  let raw = 0, gzip = 0;
  const files = [];
  for (const key of seen) { const file = manifest[key]?.file; if (!file?.endsWith('.js')) continue; const bytes = fs.readFileSync(path.join(root,file)); raw += bytes.length; gzip += gzipSync(bytes).length; files.push(file); }
  console.log(JSON.stringify({target,raw,gzip,files}));
}
