import { Volume2, VolumeX } from "lucide-react";
import { useMusic } from "@/components/MusicProvider";

/**
 * Persistent mute/unmute chip. Compact and left-aligned so it never covers
 * Create (top-right) or the create-pool dialog (z-50).
 */
export function MusicToggle() {
  const { muted, toggleMute } = useMusic();

  return (
    <div
      className="music-modal"
      role="group"
      aria-label="Background music"
      data-testid="music-modal"
    >
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute music" : "Mute music"}
        className="music-modal-btn"
      >
        {muted ? (
          <VolumeX size={15} strokeWidth={2.2} aria-hidden />
        ) : (
          <Volume2 size={15} strokeWidth={2.2} aria-hidden />
        )}
        <span className="hidden sm:inline">{muted ? "Unmute" : "Mute"}</span>
      </button>
    </div>
  );
}
