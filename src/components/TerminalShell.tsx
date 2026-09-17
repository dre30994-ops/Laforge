import { useEffect, useRef, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Sidebar } from "@/components/Sidebar";

export function TerminalShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const pathname = useRouter().state.location.pathname;

  const close = () => {
    setOpen(false);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setShown(false), 220);
  };

  const toggle = () => {
    if (open) close();
    else {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
      setShown(true);
      requestAnimationFrame(() => setOpen(true));
    }
  };

  useEffect(() => {
    close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (closeTimer.current) window.clearTimeout(closeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="terminal-root terminal-grid">
      <div className="relative z-[1] flex min-h-screen">
        <div className="hidden lg:block w-[248px] shrink-0 p-4 sticky top-0 h-screen">
          <Sidebar />
        </div>

        <button
          type="button"
          className={`forge-burger lg:hidden${open ? " is-open" : ""}`}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-sidebar"
          onClick={toggle}
        >
          <span className={`forge-burger-mark${open ? " is-open" : ""}`} aria-hidden>
            <span />
            <span />
            <span />
          </span>
        </button>

        {shown && (
          <>
            <button
              type="button"
              className={`forge-drawer-scrim lg:hidden${open ? " is-open" : ""}`}
              aria-label="Close menu"
              onClick={close}
            />
            <div
              id="mobile-sidebar"
              className={`forge-drawer lg:hidden${open ? " is-open" : ""}`}
            >
              <div className="forge-drawer-panel">
                <Sidebar />
              </div>
            </div>
          </>
        )}

        <div className="flex-1 min-w-0 pt-14 lg:pt-0">{children}</div>
      </div>
    </div>
  );
}
