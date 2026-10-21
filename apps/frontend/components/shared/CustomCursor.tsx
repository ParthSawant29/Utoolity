"use client";

import { useEffect, useState } from "react";
import { useUserPreference } from "@/lib/user-preference";

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "[role='button']",
  "[role='link']",
  "summary",
  "select",
  "input[type='checkbox']",
  "input[type='radio']",
  "input[type='range']",
  "label[for]",
  ".desktop-app-icon",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type CursorPosition = {
  x: number;
  y: number;
  visible: boolean;
  interactive: boolean;
};

export default function CustomCursor() {
  const [sizeValue] = useUserPreference<string>("utoolity.cursor-size", "32");
  const [position, setPosition] = useState<CursorPosition>({
    x: 0,
    y: 0,
    visible: false,
    interactive: false,
  });

  const parsedSize = Number(sizeValue);
  const size = Number.isFinite(parsedSize)
    ? Math.min(64, Math.max(16, parsedSize))
    : 32;

  useEffect(() => {
    const updateCursor = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== "mouse") {
        setPosition((current) => ({ ...current, visible: false }));
        return;
      }

      const target = event.target;
      const interactive =
        target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));

      setPosition({
        x: event.clientX,
        y: event.clientY,
        visible: true,
        interactive,
      });
    };

    const hideCursor = () =>
      setPosition((current) => ({ ...current, visible: false }));

    window.addEventListener("pointermove", updateCursor, { passive: true });
    window.addEventListener("pointerdown", updateCursor, { passive: true });
    window.addEventListener("blur", hideCursor);
    document.addEventListener("mouseleave", hideCursor);

    return () => {
      window.removeEventListener("pointermove", updateCursor);
      window.removeEventListener("pointerdown", updateCursor);
      window.removeEventListener("blur", hideCursor);
      document.removeEventListener("mouseleave", hideCursor);
    };
  }, []);

  const hotspotX = size * (position.interactive ? 0.44 : 0.18);
  const hotspotY = size * (position.interactive ? 0.05 : 0.09);

  return (
    <img
      aria-hidden="true"
      alt=""
      draggable={false}
      src={
        position.interactive
          ? "/cursors/bibata-hand.svg"
          : "/cursors/bibata-pointer.svg"
      }
      className="utoolity-custom-cursor"
      style={{
        left: position.x - hotspotX,
        top: position.y - hotspotY,
        width: size,
        height: size,
        opacity: position.visible ? 1 : 0,
      }}
    />
  );
}
