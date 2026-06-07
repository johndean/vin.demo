/* Build the Electron renderer: esbuild-bundle src/main.tsx → dist/bundle.js, then copy
   the static shell (index.html), the 3 stylesheets, fonts, and assets into dist/.
   All asset references are RELATIVE (./…) so the app loads correctly under file://. */
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/main.tsx'],
  bundle: true,
  outfile: 'dist/bundle.js',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts' },
  format: 'iife',
  target: 'es2020',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

cpSync('index.html', 'dist/index.html');
for (const f of ['tokens.css', 'vin-demo.css', 'control-room.css', 'login.css']) cpSync(`styles/${f}`, `dist/${f}`);
cpSync('fonts', 'dist/fonts', { recursive: true });
cpSync('assets', 'dist/assets', { recursive: true });

console.log('✓ built dist/ (bundle.js + html + css + fonts + assets)');
