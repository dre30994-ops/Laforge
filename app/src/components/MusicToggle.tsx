"use client";

import { usePathname } from "next/navigation";
import { useMusic } from "@/components/MusicProvider";

/**
 * Floating audio mute/unmute control, wired to the shared cross-page music
 * (MusicProvider). Rendered globally by the root layout so it appears on every
 * page. It hides itself on the landing page ("/"), which has its own dedicated
 * toggle in the hero.
 */
export function MusicToggle() {
  const { muted, toggleMute } = useMusic();
  const pathname = usePathname();

  // Landing page has its own toggle — don't double up.
  if (pathname === "/") return null;

  return (
    <button
      onClick={toggleMute}
      aria-label={muted ? "Unmute music" : "Mute music"}
      title={muted ? "Unmute music" : "Mute music"}
      className="fixed top-5 right-5 z-50 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-110 active:scale-95"
      style={{
        background: "rgba(255,255,255,0.94)",
        border: "1px solid rgba(20,18,10,0.06)",
        backdropFilter: "blur(8px)",
        color: muted ? "rgba(20,18,10,0.35)" : "rgba(255,207,77,0.9)",
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
        // Sound-on icon
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        </svg>
      )}
    </button>
  );
}
