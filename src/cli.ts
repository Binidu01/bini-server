#!/usr/bin/env node
import { existsSync } from 'fs';

process.env.NODE_ENV = 'production';

const envFiles = [
  '.env.local',
  '.env.production.local',
  '.env.production',
  '.env',
];

for (const file of envFiles) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// Dynamic import AFTER env loading
const { start } = await import('./index.js');
start().catch((err) => {
  console.error(err);
  process.exit(1);
});