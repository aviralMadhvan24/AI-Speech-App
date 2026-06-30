import { useEffect, useRef } from 'react';
import { MAX_WPM, ZONE_ARCS, getZoneColor } from '../utils/zones.js';

/**
 * Canvas gauge with a needle that smoothly animates toward the target WPM.
 */
export default function Speedometer({ wpm, isAverage = false }) {
  const canvasRef = useRef(null);
  const animatedRef = useRef(0);
  const targetRef = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    targetRef.current = wpm;
  }, [wpm]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    const draw = (value) => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h - 50;
      const radius = 250;
      const startAngle = Math.PI;
      const rounded = Math.round(value);

      ctx.clearRect(0, 0, w, h);

      // Outer chrome bezel ring
      const bezel = ctx.createLinearGradient(0, cy - radius, 0, cy);
      bezel.addColorStop(0, '#3a3d47');
      bezel.addColorStop(0.5, '#0c0d11');
      bezel.addColorStop(1, '#23252d');
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 26, startAngle, 2 * Math.PI);
      ctx.lineWidth = 16;
      ctx.strokeStyle = bezel;
      ctx.lineCap = 'butt';
      ctx.stroke();

      // Dark base track
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, 2 * Math.PI);
      ctx.lineWidth = 30;
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineCap = 'round';
      ctx.stroke();

      // Zone arcs — the active zone glows brighter
      ZONE_ARCS.forEach((zone) => {
        const aStart = startAngle + (zone.from / MAX_WPM) * Math.PI;
        const aEnd = startAngle + (zone.to / MAX_WPM) * Math.PI;
        const active = rounded >= zone.from && rounded < zone.to;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, aStart, aEnd);
        ctx.lineWidth = 30;
        ctx.strokeStyle = zone.color;
        ctx.globalAlpha = active ? 1 : 0.28;
        if (active) {
          ctx.shadowBlur = 22;
          ctx.shadowColor = zone.color;
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
      });

      // Tick marks + labels
      for (let i = 0; i <= MAX_WPM; i += 20) {
        const angle = startAngle + (i / MAX_WPM) * Math.PI;
        const isMajor = i % 40 === 0;
        const innerR = radius - (isMajor ? 42 : 32);
        const outerR = radius - 20;

        ctx.beginPath();
        ctx.moveTo(cx + innerR * Math.cos(angle), cy + innerR * Math.sin(angle));
        ctx.lineTo(cx + outerR * Math.cos(angle), cy + outerR * Math.sin(angle));
        ctx.lineWidth = isMajor ? 3 : 1.5;
        ctx.strokeStyle = isMajor ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)';
        ctx.stroke();

        if (isMajor) {
          const labelR = innerR - 20;
          ctx.font = '600 16px "Orbitron", sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(i), cx + labelR * Math.cos(angle), cy + labelR * Math.sin(angle));
        }
      }

      // Needle
      const clamped = Math.min(Math.max(value, 0), MAX_WPM);
      const needleAngle = startAngle + (clamped / MAX_WPM) * Math.PI;
      const needleLength = radius - 58;
      const tipX = cx + needleLength * Math.cos(needleAngle);
      const tipY = cy + needleLength * Math.sin(needleAngle);
      const color = getZoneColor(rounded);

      // Tail (small counterweight)
      const tailX = cx - 26 * Math.cos(needleAngle);
      const tailY = cy - 26 * Math.sin(needleAngle);

      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(tipX, tipY);
      ctx.lineWidth = 5;
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.shadowBlur = 18;
      ctx.shadowColor = color;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Glowing needle tip
      ctx.beginPath();
      ctx.arc(tipX, tipY, 7, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.shadowBlur = 16;
      ctx.shadowColor = color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Center hub
      ctx.beginPath();
      ctx.arc(cx, cy, 16, 0, 2 * Math.PI);
      ctx.fillStyle = '#0c0d11';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    };

    const loop = () => {
      const diff = targetRef.current - animatedRef.current;
      animatedRef.current += diff * 0.22;
      if (Math.abs(diff) < 0.5) animatedRef.current = targetRef.current;
      draw(animatedRef.current);
      rafRef.current = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div className="speedometer">
      <canvas ref={canvasRef} width="640" height="400" />
      <div className="wpm-display">
        <div
          className="wpm-value"
          style={{
            color: getZoneColor(Math.round(wpm)),
            textShadow: `0 0 28px ${getZoneColor(Math.round(wpm))}66`,
          }}
        >
          {Math.round(wpm)}
        </div>
        <div className="wpm-label">{isAverage ? 'avg words / min' : 'words / min'}</div>
      </div>
    </div>
  );
}
