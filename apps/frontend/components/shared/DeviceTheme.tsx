"use client";

import { useEffect } from "react";

function applyDeviceTheme(mediaQuery: MediaQueryList) {
  const savedTheme = localStorage.getItem("utoolity.theme");
  // A stored explicit preference wins. Follow OS changes only when no valid
  // explicit preference exists, so lock-screen and desktop stay in sync.
  const theme =
    savedTheme === "dark"
      ? "dark"
      : savedTheme === "light"
        ? "light"
        : mediaQuery.matches
          ? "dark"
          : "light";
  const root = document.documentElement;

  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
}

export default function DeviceTheme() {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleThemeChange = () => applyDeviceTheme(mediaQuery);

    handleThemeChange();
    mediaQuery.addEventListener("change", handleThemeChange);

    return () => mediaQuery.removeEventListener("change", handleThemeChange);
  }, []);

  return null;
}
