// WPM zone helpers. Green zone is 120-160 (ideal speaking pace).

export const MAX_WPM = 260;

export const ZONE_ARCS = [
  { from: 0, to: 80, color: '#ff2e43' },
  { from: 80, to: 120, color: '#ffb020' },
  { from: 120, to: 160, color: '#39ff88' },
  { from: 160, to: 200, color: '#ffb020' },
  { from: 200, to: 260, color: '#ff2e43' },
];

export function getZoneColor(wpm) {
  if (wpm >= 120 && wpm <= 160) return '#39ff88';
  if ((wpm >= 80 && wpm < 120) || (wpm > 160 && wpm <= 200)) return '#ffb020';
  if (wpm === 0) return '#6a6a78';
  return '#ff2e43';
}

export function getZone(wpm) {
  if (wpm === 0) return { text: 'Ready', cls: 'zone-idle' };
  if (wpm >= 120 && wpm <= 160) return { text: '\u2713 Perfect Pace', cls: 'zone-green' };
  if (wpm >= 80 && wpm < 120) return { text: '\u2191 A Bit Slow', cls: 'zone-yellow' };
  if (wpm > 160 && wpm <= 200) return { text: '\u2193 A Bit Fast', cls: 'zone-yellow' };
  if (wpm < 80) return { text: '\u26A0 Too Slow', cls: 'zone-red' };
  return { text: '\u26A0 Too Fast', cls: 'zone-red' };
}

export function normalizeWord(w) {
  return w.toLowerCase().replace(/[^a-z0-9']/g, '');
}
