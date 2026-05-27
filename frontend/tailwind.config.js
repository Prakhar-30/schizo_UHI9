/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#08080a',
          soft: '#0e0e12',
          card: '#121218',
          line: '#26262f',
        },
        bone: '#f3efe4',
        // FEE-T / yield leg
        yield: {
          DEFAULT: '#c6ff2e',
          dim: '#9bcc16',
        },
        // IL-T / risk leg
        risk: {
          DEFAULT: '#ff2e6d',
          dim: '#c01b4f',
        },
        // primary electric accent
        volt: {
          DEFAULT: '#7c5cff',
          dim: '#5a3ff0',
        },
        mint: '#2ef8d8',
        amber: '#ffb020',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        black: ['"Archivo Black"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        brutal: '6px 6px 0 0 #08080a',
        'brutal-sm': '4px 4px 0 0 #08080a',
        'brutal-lg': '10px 10px 0 0 #08080a',
        'brutal-volt': '6px 6px 0 0 #7c5cff',
        'brutal-yield': '6px 6px 0 0 #c6ff2e',
        'brutal-risk': '6px 6px 0 0 #ff2e6d',
        'brutal-bone': '6px 6px 0 0 #f3efe4',
        glow: '0 0 0 1px rgba(255,255,255,0.06), 0 20px 60px -20px rgba(124,92,255,0.5)',
      },
      backgroundImage: {
        grid: 'linear-gradient(to right, rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.04) 1px, transparent 1px)',
        noise:
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
      },
      keyframes: {
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-14px)' },
        },
        blob: {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(40px,-30px) scale(1.1)' },
          '66%': { transform: 'translate(-30px,20px) scale(0.95)' },
        },
        glitch: {
          '0%,100%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px,1px)' },
          '40%': { transform: 'translate(2px,-1px)' },
          '60%': { transform: 'translate(-1px,-1px)' },
          '80%': { transform: 'translate(1px,1px)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(46,248,216,0.5)' },
          '70%': { boxShadow: '0 0 0 12px rgba(46,248,216,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(46,248,216,0)' },
        },
      },
      animation: {
        marquee: 'marquee 28s linear infinite',
        'marquee-fast': 'marquee 16s linear infinite',
        float: 'float 7s ease-in-out infinite',
        blob: 'blob 18s ease-in-out infinite',
        glitch: 'glitch 0.4s steps(2) infinite',
        scan: 'scan 4s linear infinite',
        pulseRing: 'pulseRing 2s ease-out infinite',
      },
    },
  },
  plugins: [],
}
