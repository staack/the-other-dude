import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: 'hsl(var(--surface))',
        elevated: 'hsl(var(--elevated))',
        border: 'hsl(var(--border))',
        'border-bright': 'hsl(var(--border-bright))',
        'text-primary': 'hsl(var(--text-primary))',
        'text-secondary': 'hsl(var(--text-secondary))',
        'text-muted': 'hsl(var(--text-muted))',
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          hover: 'hsl(var(--accent-hover))',
          muted: 'hsl(var(--accent-muted))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--text-primary))',
        },
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        sidebar: 'hsl(var(--sidebar))',
        online: 'hsl(var(--online))',
        offline: 'hsl(var(--offline))',
        unknown: 'hsl(var(--unknown))',
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        error: 'hsl(var(--error))',
        info: 'hsl(var(--info))',
        'chart-1': 'hsl(var(--chart-1))',
        'chart-2': 'hsl(var(--chart-2))',
        'chart-3': 'hsl(var(--chart-3))',
        'chart-4': 'hsl(var(--chart-4))',
        'chart-5': 'hsl(var(--chart-5))',
        'chart-6': 'hsl(var(--chart-6))',
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      animation: {
        shimmer: 'shimmer 1.5s ease-in-out infinite',
      },
      backgroundImage: {
        shimmer:
          'linear-gradient(90deg, transparent 0%, hsl(var(--elevated)) 20%, hsl(var(--surface)) 50%, hsl(var(--elevated)) 80%, transparent 100%)',
      },
      backgroundSize: {
        shimmer: '200% 100%',
      },
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: 'var(--radius)',
        md: '0.375rem',
        lg: 'var(--radius)',
        xl: '0.75rem',
      },
    },
  },
  plugins: [],
}

export default config
