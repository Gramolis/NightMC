#!/usr/bin/env node
/**
 * Generuje build/icon.ico oraz build/icon.png z oryginalnego logo NightMC
 * (półksiężyc + geometryczna litera "N"). Nie używa żadnych elementów marki Minecraft.
 *
 * Uruchomienie: npm run icon
 */
import sharp from 'sharp';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'build');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1024" y2="1024" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#141833"/>
      <stop offset="0.55" stop-color="#0b0d1c"/>
      <stop offset="1" stop-color="#05060f"/>
    </linearGradient>
    <linearGradient id="moon" x1="180" y1="120" x2="860" y2="920" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#C9B8FF"/>
      <stop offset="0.5" stop-color="#7A5CFF"/>
      <stop offset="1" stop-color="#3FD0E8"/>
    </linearGradient>
    <linearGradient id="letter" x1="520" y1="330" x2="800" y2="720" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#A9EEFA"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="26" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <radialGradient id="halo" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#7A5CFF" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#7A5CFF" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <circle cx="512" cy="512" r="430" fill="url(#halo)"/>

  <g filter="url(#glow)">
    <path d="M512 96C282.4 96 96 282.4 96 512s186.4 416 416 416c67.1 0 130.5-15.9 186.7-44.2
             C542.4 826.6 427 677.6 427 501.4S542.4 176.2 698.7 140.2A414.6 414.6 0 0 0 512 96Z"
          fill="url(#moon)"/>
    <path d="M566 736V352l224 288V352"
          stroke="url(#letter)" stroke-width="66" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <circle cx="820" cy="196" r="27" fill="#EDE8FF"/>
    <circle cx="906" cy="380" r="16" fill="#9FE9F6"/>
    <circle cx="742" cy="884" r="15" fill="#C9B8FF"/>
    <circle cx="884" cy="700" r="10" fill="#EDE8FF"/>
  </g>
</svg>`;

/** Pakuje zestaw PNG-ów do pliku .ico. */
function packIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);      // reserved
  header.writeUInt16LE(1, 2);      // type: 1 = ikona
  header.writeUInt16LE(count, 4);  // liczba obrazów

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;

  images.forEach((img, i) => {
    const e = 16 * i;
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0); // szerokość (0 = 256)
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1); // wysokość
    entries.writeUInt8(0, e + 2);   // liczba kolorów palety
    entries.writeUInt8(0, e + 3);   // reserved
    entries.writeUInt16LE(1, e + 4);  // planes
    entries.writeUInt16LE(32, e + 6); // bitów na piksel
    entries.writeUInt32LE(img.data.length, e + 8);
    entries.writeUInt32LE(offset, e + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, entries, ...images.map((i) => i.data)]);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const svg = Buffer.from(SVG, 'utf8');

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = [];
  for (const size of sizes) {
    const data = await sharp(svg, { density: 384 }).resize(size, size, { fit: 'contain' }).png({ compressionLevel: 9 }).toBuffer();
    images.push({ size, data });
  }

  await writeFile(path.join(outDir, 'icon.ico'), packIco(images));
  await sharp(svg, { density: 384 }).resize(512, 512).png().toFile(path.join(outDir, 'icon.png'));
  await writeFile(path.join(outDir, 'icon.svg'), SVG, 'utf8');

  console.log(`[NightMC] build/icon.ico gotowa (${sizes.join(', ')} px)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
