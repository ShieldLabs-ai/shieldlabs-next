// Runs before the type check, lint and build. Until @shieldlabs-ai/js, @shieldlabs-ai/react and
// @shieldlabs-ai/node are on npm, `npm ci` leaves out these peer dependencies and the tools would fail
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
      'Until they are on npm, build a pack of each from working copies next to this repository and',
      'install the three packs (repeat the install after every npm ci):',
      '',
      '  (cd ../shieldlabs-js && npm ci && npm run build && npm pack)',
      '  (cd ../shieldlabs-react && npm ci && npm install --no-save ../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz && npm run build && npm pack)',
      '  (cd ../shieldlabs-node && npm ci && npm pack)',
      '  npm install --no-save --legacy-peer-deps=false ../shieldlabs-js/shieldlabs-ai-js-1.0.0.tgz \\',
      '    ../shieldlabs-react/shieldlabs-ai-react-1.0.0.tgz ../shieldlabs-node/shieldlabs-ai-node-1.0.0.tgz',
      '',
      'See CONTRIBUTING.md.',
    ].join('\n'),
  );
  process.exit(1);
}
