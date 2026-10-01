// Removes the previous build before tsup writes both entries (the two builds run in parallel, so
// neither of them may clean the output folder itself).
import { rmSync } from 'node:fs';

rmSync(new URL('../dist', import.meta.url), { recursive: true, force: true });
