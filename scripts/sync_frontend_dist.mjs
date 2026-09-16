import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'frontend/dist');
const target = resolve(root, 'services/api-gateway-go/internal/web/dist');

if (!existsSync(source)) {
  throw new Error('frontend/dist does not exist. Run npm run build in frontend first.');
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
