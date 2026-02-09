import { cpSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

cpSync(join(root, 'src/public'), join(root, 'dist/public'), { recursive: true });
console.log('Copied public folder to dist/');
