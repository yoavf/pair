#!/usr/bin/env node

/**
 * UI Preview Runner
 *
 * Runs the UI preview to showcase all design variations.
 * This helps verify visual design changes before testing in the full app.
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  console.log('🎨 Starting Claude Pair UI Preview...\n');

  // Run the preview with tsx
  const previewPath = join(__dirname, 'preview.tsx');
  execSync(`npx tsx "${previewPath}"`, {
    stdio: 'inherit',
    cwd: join(__dirname, '..')
  });

} catch (error) {
  console.error('❌ Preview failed:', error.message);
  process.exit(1);
}