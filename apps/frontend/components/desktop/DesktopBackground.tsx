"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type Wallpaper = { file: string; url: string };
type Layer = { url: string; key: number };

function findThemeWallpaper(wallpapers: Wallpaper[], theme: "dark" | "light") {
  return wallpapers.find(({ file }) =>
    new RegExp(`^${theme}\\.(avif|jpe?g|png|webp)$`, "i").test(file),
  );
}

export default function DesktopBackground() {
  const [active, setActive] = useState<Layer | null>(null);
  const [previous, setPrevious] = useState<Layer | null>(null);
  const [visible, setVisible] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");

  useEffect(() => {
    let available: Wallpaper[] = [];
    let currentLayer: Layer | null = null;
    let nextKey = 0;
    let currentTheme: "dark" | "light" = document.documentElement.classList.contains("dark") ? "dark" : "light";
    let cancelled = false;

    const apply = (nextTheme: "dark" | "light") => {
      const root = document.documentElement;
      const selected = root.dataset.wallpaper;
      const selectedWallpaper =
        findThemeWallpaper(available, nextTheme) ??
        available.find(({ file }) => file === selected) ??
        available.find(({ file }) => file.toLowerCase() === "default.jpg") ??
        available[0];

      currentTheme = nextTheme;
      setTheme(nextTheme);
      if (!selectedWallpaper) return;

      const nextUrl = selectedWallpaper.url;
      if (currentLayer?.url === nextUrl) return;
      const nextLayer = { url: nextUrl, key: ++nextKey };
      setPrevious(currentLayer);
      currentLayer = nextLayer;
      setVisible(false);
      setActive(nextLayer);
    };

    const getTheme = (): "dark" | "light" =>
      document.documentElement.classList.contains("dark") ? "dark" : "light";
    const onThemeOrWallpaperChange = () => apply(getTheme());
    const observer = new MutationObserver(() => {
      const nextTheme = getTheme();
      if (nextTheme !== currentTheme) apply(nextTheme);
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("utoolity:wallpaper-changed", onThemeOrWallpaperChange);

    void fetch("/api/wallpapers", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Wallpaper request failed: ${response.status}`);
        return response.json() as Promise<{ wallpapers?: Wallpaper[] }>;
      })
      .then(({ wallpapers = [] }) => {
        if (cancelled) return;
        available = wallpapers;
        apply(getTheme());
      })
      .catch(() => {
        if (!cancelled) {
          available = [];
          setActive(null);
        }
      });

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("utoolity:wallpaper-changed", onThemeOrWallpaperChange);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => setVisible(true));
    const timeout = window.setTimeout(() => setPrevious(null), 750);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [active]);

  return (
    <div
      aria-hidden="true"
      className="desktop-background pointer-events-none fixed inset-0 -z-10 isolate overflow-hidden bg-background"
      data-wallpaper-theme={theme}
    >
      {previous && (
        <div
          key={previous.key}
          className="absolute inset-0 bg-cover bg-center opacity-0 transition-opacity duration-700 ease-in-out"
          style={{ backgroundImage: `url("${previous.url}")` }}
        />
      )}
      {active && (
        <div
          key={active.key}
          className={`absolute inset-0 bg-cover bg-center transition-opacity duration-700 ease-in-out ${visible ? "opacity-100" : "opacity-0"}`}
          style={{ backgroundImage: `url("${active.url}")` }}
        />
      )}
      <div className="desktop-background-wash absolute inset-0" />

      <div className="absolute inset-0 flex items-center justify-center">
        <Image
          src="/Logo.svg"
          alt=""
          width={360}
          height={360}
          priority
          className="desktop-logo h-[min(42vw,42vh,360px)] w-[min(42vw,42vh,360px)] object-contain opacity-90"
        />
      </div>

      <div className="desktop-background-vignette absolute inset-0" />
    </div>
  );
}