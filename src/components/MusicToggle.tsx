import { Volume2, VolumeX } from "lucide-react";
import { useMusic } from "@/components/MusicProvider";

export function MusicToggle() {
  const { muted, toggleMute } = useMusic();

  return (
    <div
      className="music-modal"
      role="dialog"
      aria-label="Background music"
      data-testid="music-modal"
    >
      <p className="music-modal-kicker">Sound</p>
      <p className="music-modal-status">
        {!muted && <span className="pulse-dot" aria-hidden />}
        {muted ? "Muted" : "Playing"}
      </p>
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? "Unmute music" : "Mute music"}
        className="music-modal-btn"
      >
        {muted ? (
          <VolumeX size={16} strokeWidth={2.2} aria-hidden />
        ) : (
          <Volume2 size={16} strokeWidth={2.2} aria-hidden />
        )}
        {muted ? "Unmute" : "Mute"}
      </button>
    </div>
  );
}
