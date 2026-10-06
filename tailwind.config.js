/** Charte graphique Atelier Motion — bleu et blanc.
 *  Les valeurs proviennent des variables CSS définies dans src/index.css. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--am-primary)', // #1E5EFF
        navy: 'var(--am-navy)', // #0A1F44
        accent: 'var(--am-accent)', // #3B82F6
        sky: 'var(--am-light)', // #DBEAFE
        canvas: 'var(--am-app-bg)', // #F0F6FF
        surface: 'var(--am-white)', // #FFFFFF
        muted: 'var(--am-muted)', // #64748B
        line: 'var(--am-border)', // #E2E8F0
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '8px',
        am: '8px',
      },
      boxShadow: {
        soft: '0 1px 2px rgba(10,31,68,0.04), 0 4px 16px rgba(10,31,68,0.06)',
        pop: '0 8px 32px rgba(10,31,68,0.16)',
      },
    },
  },
  plugins: [],
};
