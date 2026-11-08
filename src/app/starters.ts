// src/app/starters.ts — starter documents for the welcome screen (original artwork).
import { SAMPLE } from '../engine/sample';

export interface Starter { name: string; file: string; description: string; svg: string }

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0f172a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M5 19c0-8 6-14 14-14c0 8-6 14-14 14z"/>
  <path d="M5 19l7-7"/>
  <circle cx="17" cy="7" r="1"/>
</svg>
`;

const APP_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4d47bd"/>
      <stop offset="1" stop-color="#753cec"/>
    </linearGradient>
  </defs>
  <rect x="32" y="32" width="448" height="448" rx="104" fill="url(#bg)"/>
  <path d="M120 360C176 120 336 400 392 152" fill="none" stroke="#ffffff" stroke-width="36" stroke-linecap="round"/>
  <circle cx="120" cy="360" r="30" fill="#ffffff"/>
  <circle cx="392" cy="152" r="30" fill="#ffffff"/>
</svg>
`;

const BANNER = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0f172a"/>
  <circle cx="1040" cy="120" r="220" fill="#6366f1" opacity="0.35"/>
  <circle cx="1120" cy="520" r="160" fill="#a855f7" opacity="0.3"/>
  <path d="M0 470C240 380 420 560 660 470S1000 380 1200 450V630H0z" fill="#1e293b"/>
  <text x="96" y="270" font-family="system-ui, sans-serif" font-size="88" font-weight="700" fill="#f8fafc">Your headline</text>
  <text x="96" y="340" font-family="system-ui, sans-serif" font-size="36" fill="#94a3b8">A short line that says what this is about.</text>
</svg>
`;

export const STARTERS: Starter[] = [
  { name: 'Feature tour', file: 'sample.svg', description: 'Every shape type, ready to edit', svg: SAMPLE },
  { name: 'Stroke icon', file: 'icon.svg', description: '24 × 24 line icon', svg: ICON },
  { name: 'App icon', file: 'app-icon.svg', description: '512 × 512 with gradient', svg: APP_ICON },
  { name: 'Social banner', file: 'banner.svg', description: '1200 × 630 card', svg: BANNER },
];
