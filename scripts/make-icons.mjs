// Generates PWA icons from one SVG source. Run: npm run icons
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync, mkdirSync } from 'node:fs';

const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#141B3C"/>
  <g transform="translate(${pad ? 76 : 36} ${pad ? 76 : 36}) scale(${pad ? 0.703 : 0.859})">
    <rect x="72" y="136" width="368" height="272" rx="56" fill="#2A3370"/>
    <rect x="72" y="176" width="368" height="232" rx="56" fill="#F4F6FB"/>
    <path d="M136 340 L212 272 L268 308 L372 212" stroke="#0E9F6E" stroke-width="34" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="372" cy="212" r="30" fill="#0E9F6E"/>
  </g>
</svg>`;

mkdirSync('public/icons', { recursive: true });
const png = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
writeFileSync('public/icons/icon-192.png', png(mark(false), 192));
writeFileSync('public/icons/icon-512.png', png(mark(false), 512));
writeFileSync('public/icons/icon-maskable-512.png', png(mark(true), 512)); // full-bleed, safe zone respected
writeFileSync('public/apple-touch-icon.png', png(mark(true), 180));
writeFileSync('public/favicon.svg', mark(false));
console.log('icons written');
