import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { OfficialLinks } from "@/components/OfficialLinks";

const VIDEOS = [
  "/a.webm",
  "/b.webm",
  "/c.webm",
  "/d.webm",
  "/e.webm",
];

const FADE_MS = 3000;
const FADE_S = FADE_MS / 1000;

export default function LandingPage() {
  const [slotClip, setSlotClip] = useState<[number, number]>([0, 1]);
  const [frontSlot, setFrontSlot] = useState<0 | 1>(0);

  const parallaxRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const smoothPos = useRef({ x: 0, y: 0 });
  const slot0Ref = useRef<HTMLVideoElement>(null);
  const slot1Ref = useRef<HTMLVideoElement>(null);

  const frontClip = slotClip[frontSlot];

  useEffect(() => {
    const frontRef = frontSlot === 0 ? slot0Ref : slot1Ref;
    const backRef = frontSlot === 0 ? slot1Ref : slot0Ref;
    const frontVid = frontRef.current;
    if (!frontVid) return;

    let fired = false;
    frontVid.play().catch(() => {});

    const startTransition = () => {
      if (fired) return;
      fired = true;

      const backSlot = (frontSlot === 0 ? 1 : 0) as 0 | 1;
      const nextClip = (frontClip + 1) % VIDEOS.length;

      setSlotClip((pairs) => {
        const updated: [number, number] = [...pairs] as [number, number];
        updated[backSlot] = nextClip;
        return updated;
      });

      requestAnimationFrame(() => {
        const bv = backRef.current;
        if (bv) {
          try {
            bv.currentTime = 0;
            bv.play().catch(() => {});
          } catch {
            /* ignore */
          }
        }
        setFrontSlot(backSlot);
      });
    };

    const onTime = () => {
      if (!frontVid.duration || Number.isNaN(frontVid.duration)) return;
      if (frontVid.currentTime >= frontVid.duration - FADE_S) startTransition();
    };
    frontVid.addEventListener("timeupdate", onTime);
    frontVid.addEventListener("ended", startTransition);
    return () => {
      frontVid.removeEventListener("timeupdate", onTime);
      frontVid.removeEventListener("ended", startTransition);
    };
  }, [frontSlot, frontClip]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const x = (e.clientX / window.innerWidth - 0.5) * 2;
      const y = (e.clientY / window.innerHeight - 0.5) * 2;
      mousePos.current = { x, y };
    };

    const tick = () => {
      smoothPos.current.x += (mousePos.current.x - smoothPos.current.x) * 0.06;
      smoothPos.current.y += (mousePos.current.y - smoothPos.current.y) * 0.06;
      const el = parallaxRef.current;
      if (el) {
        const tx = smoothPos.current.x * 12;
        const ty = smoothPos.current.y * 8;
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(1.08)`;
      }
      animFrameRef.current = requestAnimationFrame(tick);
    };

    window.addEventListener("mousemove", handleMouseMove);
    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      <div
        ref={parallaxRef}
        className="absolute inset-[-4%]"
        style={{
          transform: "scale(1.08)",
          filter: "saturate(1.4) contrast(1.1) brightness(1.06)",
        }}
      >
        <video
          ref={slot0Ref}
          className="absolute inset-0 w-full h-full object-cover"
          src={VIDEOS[slotClip[0]]}
          muted
          playsInline
          preload="auto"
          style={{
            opacity: frontSlot === 0 ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
          }}
        />
        <video
          ref={slot1Ref}
          className="absolute inset-0 w-full h-full object-cover"
          src={VIDEOS[slotClip[1]]}
          muted
          playsInline
          preload="auto"
          style={{
            opacity: frontSlot === 1 ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
          }}
        />
      </div>

      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.72) 100%)",
        }}
      />

      <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 text-center">
        <OfficialLinks compact />
        <img
          src="/icon2_nobg.png"
          alt=""
          className="h-16 w-16 mt-6 mb-5 drop-shadow-[0_0_24px_rgba(255,207,77,0.45)]"
        />
        <p className="text-[11px] font-semibold tracking-[0.28em] uppercase text-amber-200/80">
          Laforge
        </p>
        <h1 className="mt-3 text-2xl md:text-3xl font-semibold tracking-tight max-w-xl leading-snug">
          <span className="text-white/90">Staking </span>
          <span className="landing-gold-accent">Nexus</span>
          <span className="text-white/55"> and </span>
          <span className="text-white/90">Gaming </span>
          <span className="landing-gold-accent">Terminal</span>
        </h1>
        <p className="mt-4 text-sm md:text-base text-white/70 max-w-md leading-relaxed">
          Multi-chain staking. Tenure-weighted yield. Marketing that a community can boost.
        </p>
        <Link
          to="/dashboard"
          className="mt-8 inline-flex items-center justify-center h-12 px-7 rounded-xl text-sm font-semibold text-bark-950 transition-transform duration-150 ease-out active:scale-[0.96]"
          style={{
            background: "linear-gradient(180deg, var(--neon-gold), var(--amber))",
          }}
        >
          Enter the terminal
        </Link>
      </div>
    </div>
  );
}
