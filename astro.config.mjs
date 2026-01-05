// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import devEditor from './src/integrations/dev-editor.ts';

// https://astro.build/config
export default defineConfig({
  site: 'https://francisco.dev', // Update this with your actual domain
  integrations: [sitemap(), devEditor()],
});
