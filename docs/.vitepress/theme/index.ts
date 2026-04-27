import type { Theme } from 'vitepress';
import DefaultTheme from 'vitepress/theme';
import './custom.css';
import './landing.css';

/*
 * Extends VitePress' default theme with the light-runner laboratory aesthetic:
 * Fraunces display, IBM Plex Sans body, JetBrains Mono labels, ink/paper/halo
 * palette, persistent grid + noise background. Defined here, applied to every
 * route under /guides/ and /api/ so the chrome matches the bespoke landing
 * served at /.
 */
export default {
  extends: DefaultTheme,
} satisfies Theme;
