import { useRouter } from "@tanstack/react-router";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from "react";

const LANDING_VOLUME = 0.4;
const OTHER_VOLUME = (LANDING_VOLUME / 2) * 0.65;

type MusicContextValue = {
  muted: boolean;
  toggleMute: () => void;
};

const MusicContext = createContext<MusicContextValue>({
  muted: false,
  toggleMute: () => {},
});

export function useMusic() {
  return useContext(MusicContext);
}

export function MusicProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [muted, setMuted] = useState(false);
  const pathname = useRouter().state.location.pathname;
  const targetVolume = pathname === "/" ? LANDING_VOLUME : OTHER_VOLUME;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = targetVolume;
    audio.play().catch(() => {});
    const startOnGesture = () => {
      audio.play().catch(() => {});
      window.removeEventListener("pointerdown", startOnGesture);
      window.removeEventListener("keydown", startOnGesture);
    };
    window.addEventListener("pointerdown", startOnGesture);
    window.addEventListener("keydown", startOnGesture);
    return () => {
      window.removeEventListener("pointerdown", startOnGesture);
      window.removeEventListener("keydown", startOnGesture);
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = targetVolume;
  }, [targetVolume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.muted = muted;
  }, [muted]);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    setMuted((prev) => !prev);
  }, []);

  return (
    <MusicContext.Provider value={{ muted, toggleMute }}>
      <audio ref={audioRef} src="/audio/medieval-tavern.mp3" loop preload="auto" />
      {children}
    </MusicContext.Provider>
  );
}
