import { useMemo } from "react";

interface Particle {
  left: string;
  top: string;
  animationDelay: string;
  animationDuration: string;
}

function makeParticles(count: number, leftBase: number, leftSpread: number): Particle[] {
  return Array.from({ length: count }).map(() => ({
    left: `${leftBase + Math.random() * leftSpread}%`,
    top: `${20 + Math.random() * 60}%`,
    animationDelay: `${Math.random() * 6}s`,
    animationDuration: `${4 + Math.random() * 4}s`,
  }));
}

export function BackgroundScene() {
  const particles = useMemo(
    () => [...makeParticles(8, 5, 20), ...makeParticles(8, 75, 20)],
    []
  );

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 50% 45%, rgba(30, 25, 15, 0.6) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 20%, rgba(184, 134, 11, 0.03) 0%, transparent 40%),
            linear-gradient(180deg, 
              #080705 0%, 
              #0d0b08 30%,
              #0f0d0a 60%,
              #0a0908 100%
            )
          `,
        }}
      />
      <div className="absolute inset-0">
        {particles.map((p, i) => (
          <div
            key={i}
            className="absolute w-0.5 h-0.5 rounded-full bg-gold-400/20 animate-glow-pulse"
            style={p}
          />
        ))}
      </div>
      <div
        className="absolute inset-0"
        style={{
          background: `radial-gradient(ellipse at center, transparent 20%, rgba(0,0,0,0.7) 80%)`,
        }}
      />
    </div>
  );
}
