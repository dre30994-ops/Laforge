import { useRef, useState } from "react";

/**
 * Audio system: medieval tavern music + optional forest ambience.
 * Click the button to start. Browser requires user interaction first.
 */
export function AudioController() {
  const ambientRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.4);
  const [ambientVolume, setAmbientVolume] = useState(0.3);

  const toggleAudio = () => {
    if (isPlaying) {
      ambientRef.current?.pause();
      musicRef.current?.pause();
      setIsPlaying(false);
    } else {
      // Play music
      if (musicRef.current) {
        musicRef.current.volume = musicVolume;
        musicRef.current.loop = true;
        musicRef.current.play().catch(() => {});
      }
      // Play ambient (may not exist - that's ok)
      if (ambientRef.current) {
        ambientRef.current.volume = ambientVolume;
        ambientRef.current.loop = true;
        ambientRef.current.play().catch(() => {});
      }
      setIsPlaying(true);
    }
  };

  const updateMusicVolume = (v: number) => {
    setMusicVolume(v);
    if (musicRef.current) musicRef.current.volume = v;
  };

  const updateAmbientVolume = (v: number) => {
    setAmbientVolume(v);
    if (ambientRef.current) ambientRef.current.volume = v;
  };

  return (
    <>
      <audio ref={ambientRef} src="/audio/forest-morning.mp3" preload="auto" />
      <audio ref={musicRef} src="/audio/medieval-tavern.mp3" preload="auto" />

      <button
        onClick={toggleAudio}
        className="fixed bottom-6 right-6 z-50 p-3 rounded-full bg-medieval-card/90 
                   border border-medieval-border hover:border-gold-500/50
                   transition-all duration-300 group"
        title={isPlaying ? "Mute audio" : "Play music"}
      >
        {isPlaying ? (
          <svg className="w-5 h-5 text-gold-400 group-hover:text-gold-300" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.5 3.75a.75.75 0 0 1 .75.75v15a.75.75 0 0 1-1.26.55l-4.2-3.8H3.75A.75.75 0 0 1 3 15.5v-7a.75.75 0 0 1 .75-.75H6.8l4.2-3.8a.75.75 0 0 1 .5-.2zm3.5 4.5a.75.75 0 0 1 1.06 0 5.5 5.5 0 0 1 0 7.5.75.75 0 1 1-1.06-1.06 4 4 0 0 0 0-5.38.75.75 0 0 1 0-1.06zm2.12-2.12a.75.75 0 0 1 1.06 0 9 9 0 0 1 0 11.74.75.75 0 1 1-1.06-1.06 7.5 7.5 0 0 0 0-9.62.75.75 0 0 1 0-1.06z"/>
          </svg>
        ) : (
          <svg className="w-5 h-5 text-medieval-muted group-hover:text-gold-400" fill="currentColor" viewBox="0 0 24 24">
            <path d="M11.5 3.75a.75.75 0 0 1 .75.75v15a.75.75 0 0 1-1.26.55l-4.2-3.8H3.75A.75.75 0 0 1 3 15.5v-7a.75.75 0 0 1 .75-.75H6.8l4.2-3.8a.75.75 0 0 1 .5-.2zm5.5 3.75a.75.75 0 0 1 .75.75v7.5a.75.75 0 0 1-1.5 0v-7.5a.75.75 0 0 1 .75-.75z"/>
          </svg>
        )}
      </button>

      {/* Volume controls - visible when playing */}
      {isPlaying && (
        <div className="fixed bottom-16 right-6 z-50 card-medieval !p-3 space-y-2 animate-fade-in">
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-medieval-muted w-12">Music</span>
            <input
              type="range"
              min="0" max="100"
              value={musicVolume * 100}
              onChange={(e) => updateMusicVolume(Number(e.target.value) / 100)}
              className="w-20 accent-gold-500 h-1"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-medieval-muted w-12">Ambient</span>
            <input
              type="range"
              min="0" max="100"
              value={ambientVolume * 100}
              onChange={(e) => updateAmbientVolume(Number(e.target.value) / 100)}
              className="w-20 accent-gold-500 h-1"
            />
          </div>
        </div>
      )}
    </>
  );
}
