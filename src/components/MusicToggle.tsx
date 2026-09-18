import { Volume2, VolumeX } from "lucide-react";
import { useMusic } from "@/components/MusicProvider";
import { useI18n } from "@/components/LanguageProvider";

/**
 * Persistent mute/unmute chip. Compact and left-aligned so it never covers
 * Create (top-right) or the create-pool dialog (z-50).
 */
export function MusicToggle() {
  const { muted, toggleMute } = useMusic();
  const { t } = useI18n();

  return (
    <div
      className="music-modal"
      role="group"
      aria-label={t("music.group")}
      data-testid="music-modal"
    >
      <button
        type="button"
        onClick={toggleMute}
        aria-label={muted ? t("music.unmuteAria") : t("music.muteAria")}
        className="music-modal-btn"
      >
        {muted ? (
          <VolumeX size={15} strokeWidth={2.2} aria-hidden />
        ) : (
          <Volume2 size={15} strokeWidth={2.2} aria-hidden />
        )}
        <span className="hidden sm:inline">{muted ? t("music.unmute") : t("music.mute")}</span>
      </button>
    </div>
  );
}
