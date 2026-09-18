import { useEffect } from "react";

const PORTAL_SELECTOR = [
  "#headlessui-portal-root",
  '[id*="privy-dialog"]',
  '[id*="privy-modal"]',
  "[data-privy-dialog]",
].join(",");

function dialogOpen() {
  return Boolean(
    document.querySelector(
      '#headlessui-portal-root [role="dialog"], [data-privy-dialog], [id*="privy-dialog"] [role="dialog"]',
    ),
  );
}

/** Hoist Privy’s portal to document.body so our filters/z-index can’t trap it. */
export function PrivyModalLayer() {
  useEffect(() => {
    const sync = () => {
      document.querySelectorAll(PORTAL_SELECTOR).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        if (node.parentElement !== document.body) {
          document.body.appendChild(node);
        }
        node.style.zIndex = "2147483000";
        node.style.filter = "none";
        node.style.pointerEvents = "auto";
        node.style.transform = "none";
      });
      document.body.classList.toggle("privy-open", dialogOpen());
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.body.classList.remove("privy-open");
    };
  }, []);

  return null;
}
