// The project's Vite config with live reload off, for the offline render scripts, so edits in
// the tree cannot reload the page mid-render.
//   npx vite --config src/audio/tools/vite.audio.config.ts      (serves on :5243)
import { defineConfig, mergeConfig, type UserConfig } from 'vite';
import base from '../../../vite.config';

export default defineConfig((env) => {
  const b = (typeof base === 'function' ? base(env) : base) as UserConfig;
  return mergeConfig(b, { server: { port: 5243, strictPort: true, hmr: false } });
});
