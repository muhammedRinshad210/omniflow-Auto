import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}'
  ],
  theme: {
    extend: {
      colors: {
        evergreen: {
          primary: '#145B50',       // Primary Deep Forest (Contrast 7.8:1 with white)
          'primary-hover': '#0F453D',
          mint: '#75BFAE',          // Soft Mint (Contrast 5.2:1 with text #20352E)
          'mint-light': '#D2EDE6',  // Inbound message bubble & chip background
          bg: '#F3F6F2',            // Low-glare calm app background
          surface: '#E5EFEA',       // Subtle section & card surface
          card: '#FFFFFF',          // Elevated pure white card surface
          text: '#20352E',          // High-contrast soft dark slate
          'text-muted': '#556E66',  // Accessible secondary label text (Contrast 4.6:1)
          border: '#CDE0D7',        // Subtle divider & outline
          gold: '#D9A75B',          // Warm Gold: Strictly decorative icons/indicators
          urgent: {
            bg: '#FEEBC8',          // Needs-Human badge background
            text: '#7B341E',        // Needs-Human badge text (Contrast 5.5:1)
            border: '#FBD38D'
          }
        }
      },
      borderRadius: {
        'card': '12px',
        'bubble': '16px',
        'badge': '9999px'
      },
      boxShadow: {
        'mist-sm': '0 1px 3px rgba(20, 91, 80, 0.05)',
        'mist-md': '0 4px 12px -2px rgba(20, 91, 80, 0.08)'
      }
    }
  },
  plugins: []
};

export default config;
