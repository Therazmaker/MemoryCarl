/**
 * Cover Art Service for MemoryCarl Music Player.
 * Automatically fetches high-resolution album cover images from the web (iTunes Search API)
 * or generates dynamic gradient SVG covers when tracks don't have embedded ID3 covers.
 */

export async function fetchOnlineCoverArt(title, artist) {
  if (!title) return null;

  try {
    const query = `${title} ${artist || ""}`.trim();
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&entity=song&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    if (data.results && data.results.length > 0) {
      const item = data.results[0];
      if (item.artworkUrl100) {
        // Upgrade image resolution from 100x100 to 600x600
        return item.artworkUrl100.replace("100x100bb", "600x600bb");
      }
    }
  } catch (err) {
    console.warn("Cover art online search failed:", err);
  }

  return null;
}

export function generateFallbackCoverSvg(title = "Música", artist = "Artista") {
  const hash = hashString(`${title}_${artist}`);
  const color1 = HSLToHex(hash % 360, 70, 45);
  const color2 = HSLToHex((hash + 120) % 360, 80, 25);

  const initial = title.charAt(0).toUpperCase() || "🎵";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${color1}" />
        <stop offset="100%" stop-color="${color2}" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" fill="url(#grad)" />
    <circle cx="256" cy="256" r="180" fill="rgba(255,255,255,0.08)" />
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="900" font-size="160" fill="#ffffff" opacity="0.9">${initial}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

function HSLToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = x => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
