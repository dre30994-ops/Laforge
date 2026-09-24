"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useMusic } from "@/components/MusicProvider";

const VIDEOS = [
  "/a.webm",
  "/b.webm",
  "/c.webm",
  "/d.webm",
  "/e.webm",
];

const FADE_MS = 3000;         // 3.0s crossfade (short enough to fit within a clip)
const FADE_S = FADE_MS / 1000;

export default function LandingPage() {
  // Two persistent video slots that never unmount. `frontSlot` is the one
  // currently visible; the other slot preloads/plays the incoming clip and
  // fades in over it. `slotClip[i]` is the VIDEOS index loaded in slot i.
  const [slotClip, setSlotClip] = useState<[number, number]>([0, 1]);
  const [frontSlot, setFrontSlot] = useState<0 | 1>(0);

  // Shared, cross-page background music (lives in MusicProvider).
  const { muted, toggleMute } = useMusic();

  const parallaxRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const smoothPos = useRef({ x: 0, y: 0 });
  const slot0Ref = useRef<HTMLVideoElement>(null);
  const slot1Ref = useRef<HTMLVideoElement>(null);

  // Index of the clip currently shown in the front slot
  const frontClip = slotClip[frontSlot];

  // ── Video-driven crossfade (two persistent slots) ──────────────────────────
  // No <video> element is ever unmounted, so a clip can never "restart" from a
  // remount. When the FRONT clip nears its natural end, we load the NEXT clip
  // into the back slot, play it from 0, and fade it to the front. Once the fade
  // completes we simply flip which slot is front — the elements stay put.
  useEffect(() => {
    const frontRef = frontSlot === 0 ? slot0Ref : slot1Ref;
    const backRef = frontSlot === 0 ? slot1Ref : slot0Ref;
    const frontVid = frontRef.current;
    if (!frontVid) return;

    let fired = false;

    // Make sure the front clip is playing from the top of its run.
    frontVid.play().catch(() => {});

    const startTransition = () => {
      if (fired) return;
      fired = true;

      const backSlot = (frontSlot === 0 ? 1 : 0) as 0 | 1;
      const nextClip = (frontClip + 1) % VIDEOS.length;

      // Load the incoming clip into the back slot and start it fresh.
      setSlotClip((pairs) => {
        const updated: [number, number] = [...pairs] as [number, number];
        updated[backSlot] = nextClip;
        return updated;
      });

      // Give React a tick to apply the new src to the back <video>, then play
      // + fade it in by flipping which slot is front.
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

    // Trigger the crossfade FADE_S before the clip's natural end, so the fade
    // COMPLETES right as the clip finishes — the clip is fully swapped out
    // before it can ever loop. With ~10s clips and a 3s fade, each clip shows
    // for ~7s solo + 3s fading = ~10s total on screen, with no mid-view loop.
    const handleTimeUpdate = () => {
      const dur = frontVid.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      if (frontVid.currentTime >= dur - FADE_S) {
        startTransition();
      }
    };
    const handleEnded = () => startTransition();

    frontVid.addEventListener("timeupdate", handleTimeUpdate);
    frontVid.addEventListener("ended", handleEnded);

    return () => {
      frontVid.removeEventListener("timeupdate", handleTimeUpdate);
      frontVid.removeEventListener("ended", handleEnded);
    };
  }, [frontSlot, frontClip]);

  // ── Mouse parallax ────────────────────────────────────────────────────────
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 2,  // -1 to 1
        y: (e.clientY / window.innerHeight - 0.5) * 2, // -1 to 1
      };
    };

    window.addEventListener("mousemove", handleMouseMove);

    const animate = () => {
      // Smooth lerp toward mouse position
      smoothPos.current.x += (mousePos.current.x - smoothPos.current.x) * 0.06;
      smoothPos.current.y += (mousePos.current.y - smoothPos.current.y) * 0.06;

      if (parallaxRef.current) {
        const strength = 18; // px of max parallax travel
        parallaxRef.current.style.transform = `translate(${smoothPos.current.x * -strength}px, ${smoothPos.current.y * -strength}px) scale(1.08)`;
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">

      {/* ── Mute toggle (controls the shared cross-page music) ── */}
      <button
        onClick={toggleMute}
        aria-label={muted ? "Unmute music" : "Mute music"}
        className="absolute top-5 right-5 z-20 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95"
        style={{
          background: "rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.15)",
          backdropFilter: "blur(8px)",
          color: muted ? "rgba(255,255,255,0.35)" : "rgba(255,207,77,0.9)",
        }}
      >
        {muted ? (
          // Muted icon
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="23" y1="9" x2="17" y2="15" />
            <line x1="17" y1="9" x2="23" y2="15" />
          </svg>
        ) : (
          // Sound on icon
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        )}
      </button>

      {/* ── Background layer ── */}
      <div
        ref={parallaxRef}
        className="absolute inset-[-8%] will-change-transform"
        style={{
          transform: "scale(1.08)",
          // Make the footage pop: richer saturation, a touch more contrast,
          // and a slight brightness lift so colors read vividly even behind
          // the darkening overlays.
          filter: "saturate(1.4) contrast(1.1) brightness(1.06)",
        }}
      >
        {/* Slot 0 — persistent, never unmounts */}
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

        {/* Slot 1 — persistent, never unmounts */}
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

      {/* ── Dark gradient overlay ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.18) 50%, rgba(0,0,0,0.42) 100%)",
        }}
      />

      {/* ── Vignette ── */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.28) 100%)",
        }}
      />

      {/* ── Content ── */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full px-6 text-center">

        {/* Logo mark */}
        <img
          src="/icon2_nobg.png"
          alt="Forge"
          width={72}
          height={72}
          className="mb-6 w-18 h-18 rounded-2xl shadow-2xl"
          style={{
            width: 72,
            height: 72,
            boxShadow: "0 0 40px rgba(255,207,77,0.4)",
          }}
        />

        {/* Title */}
        <h1
          className="text-5xl md:text-7xl font-bold tracking-tight mb-3"
          style={{
            color: "#fff",
            textShadow: "0 2px 24px rgba(0,0,0,0.9)",
            letterSpacing: "-0.02em",
          }}
        >
          Forge World
        </h1>

        {/* Subtitle */}
        <p
          className="text-base md:text-lg font-mono uppercase tracking-[0.25em] mb-2"
          style={{ color: "rgba(255,207,77,0.9)", textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}
        >
          Staking Nexus and Gaming Terminal
        </p>

        <p
          className="max-w-md text-sm md:text-base mb-10 leading-relaxed"
          style={{ color: "rgba(255,255,255,0.85)", textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}
        >
          Create your own pool · emissions ramp 1.0×→2.0× over 1 day · tenure grows hourly
        </p>

        {/* CTA */}
        <Link
          href="/dashboard"
          className="group relative inline-flex items-center gap-3 px-8 py-4 rounded-2xl text-sm font-semibold tracking-wide uppercase transition-all duration-300 hover:scale-105 active:scale-95"
          style={{
            background: "linear-gradient(180deg, #ffcf4d, #d97706)",
            color: "#0a0c0f",
            boxShadow: "0 0 32px rgba(255,207,77,0.35), 0 4px 24px rgba(0,0,0,0.4)",
          }}
        >
          Enter Terminal
          <svg
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
          >
            <path
              fillRule="evenodd"
              d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </Link>

        {/* Video indicator dots */}
        <div className="absolute bottom-8 flex gap-2">
          {VIDEOS.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all duration-500"
              style={{
                width: i === frontClip ? "24px" : "8px",
                height: "8px",
                background:
                  i === frontClip
                    ? "rgba(255,207,77,0.9)"
                    : "rgba(255,255,255,0.3)",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
