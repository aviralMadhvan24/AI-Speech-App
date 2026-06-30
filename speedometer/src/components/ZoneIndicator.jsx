import { getZone } from '../utils/zones.js';

export default function ZoneIndicator({ wpm }) {
  const zone = getZone(Math.round(wpm));
  return <div className={`zone-indicator ${zone.cls}`}>{zone.text}</div>;
}
