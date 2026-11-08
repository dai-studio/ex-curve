export const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="960" height="600" viewBox="0 0 960 600">
  <defs>
    <symbol id="star" viewBox="-10 -10 20 20">
      <polygon points="0,-10 2.9,-4 9.5,-3.1 4.7,1.5 5.9,8.1 0,5 -5.9,8.1 -4.7,1.5 -9.5,-3.1 -2.9,-4" fill="#f5b700"/>
    </symbol>
  </defs>
  <rect x="40" y="40" width="200" height="120" rx="18" fill="#7cc6fe" stroke="#1d4e89" stroke-width="2"/>
  <circle cx="360" cy="100" r="60" fill="#f49cbb" stroke="#880d1e" stroke-width="2"/>
  <ellipse cx="560" cy="100" rx="90" ry="50" fill="#b8e0d2" stroke="#2a6f4e" stroke-width="2"/>
  <line x1="700" y1="50" x2="900" y2="150" stroke="#333" stroke-width="4" stroke-linecap="round"/>
  <polyline points="40,260 100,200 160,260 220,200 280,260" fill="none" stroke="#6a4c93" stroke-width="4"/>
  <polygon points="360,200 430,240 410,320 310,320 290,240" fill="#ffd166" stroke="#a5630b" stroke-width="2"/>
  <path d="M500 300 C500 220 600 220 600 300 S700 380 700 300 Q750 230 800 300 T900 300" fill="none" stroke="#118ab2" stroke-width="4"/>
  <path d="m40 420 l60 -40 h60 v40 a40 30 0 0 1 80 0 z" fill="#ef476f" fill-opacity="0.6" stroke="#9e1b3b" stroke-width="2"/>
  <text x="320" y="420" font-family="Georgia, serif" font-size="36" fill="#222">Curve</text>
  <g transform="translate(620 420) rotate(-12)">
    <rect x="0" y="0" width="120" height="80" fill="#06d6a0" stroke="#05624a"/>
    <circle cx="160" cy="40" r="30" fill="#073b4c"/>
  </g>
  <use href="#star" x="820" y="480" width="80" height="80"/>
</svg>
`;
