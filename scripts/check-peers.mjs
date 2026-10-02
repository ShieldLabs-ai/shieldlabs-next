// Runs before the type check, lint and build. With the repository's .npmrc, `npm ci` leaves out
// @shieldlabs-ai/js, @shieldlabs-ai/react and @shieldlabs-ai/node and the tools would fail
// with "Cannot find module". This check names the missing step instead (see CONTRIBUTING.md).
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const peers = ['@shieldlabs-ai/js', '@shieldlabs-ai/react', '@shieldlabs-ai/node'];

function installedVersion(name) {
  try {
    return JSON.parse(readFileSync(require.resolve(name + '/package.json'), 'utf8')).version;
  } catch {
    return null;
  }
}

const problems = [];
for (const name of peers) {
  const version = installedVersion(name);
  if (typeof version !== 'string') problems.push(name + ' is not installed.');
  else if (!version.startsWith('1.')) problems.push('Found ' + name + ' ' + version + ', expected 1.x.');
}

if (problems.length > 0) {
  console.error(
    [
      '@shieldlabs-ai/next needs @shieldlabs-ai/js, @shieldlabs-ai/react and @shieldlabs-ai/node 1.x as peer dependencies.',
      ...problems.map((problem) => '  ' + problem),
      '',
      'Install the published peers from this repository root (repeat after every npm ci):',
      '',
      "  npm install --no-save --legacy-peer-deps=false '@shieldlabs-ai/js@^1.0.0' '@shieldlabs-ai/react@^1.0.0' '@shieldlabs-ai/node@^1.0.0'",
      '',
      'See CONTRIBUTING.md.',
    ].join('\n'),
  );
  process.exit(1);
}
