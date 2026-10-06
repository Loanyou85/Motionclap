/** Charte graphique Atelier Motion — bleu et blanc.
 *  Les valeurs proviennent des variables CSS définies dans src/index.css. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--am-primary-rgb) / <alpha-value>)', // #1E5EFF
        navy: 'rgb(var(--am-navy-rgb) / <alpha-value>)', // #0A1F44
        accent: 'rgb(var(--am-accent-rgb) / <alpha-value>)', // #3B82F6
        sky: 'rgb(var(--am-light-rgb) / <alpha-value>)', // #DBEAFE
        canvas: 'rgb(var(--am-app-bg-rgb) / <alpha-value>)', // #F0F6FF
        surface: 'rgb(var(--am-white-rgb) / <alpha-value>)', // #FFFFFF
        muted: 'rgb(var(--am-muted-rgb) / <alpha-value>)', // #64748B
        line: 'rgb(var(--am-border-rgb) / <alpha-value>)', // #E2E8F0
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
