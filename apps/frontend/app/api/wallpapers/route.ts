import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const allowed = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);
const prettyName = (value: string) =>
  value.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

export async function GET() {
  const directory = path.join(process.cwd(), "public", "wallpapers");
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const wallpapers = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() || (entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(async (entry) => {
          if (entry.isFile()) {
            return {
              file: entry.name,
              name: prettyName(path.basename(entry.name, path.extname(entry.name))),
              url: `/wallpapers/${encodeURIComponent(entry.name)}`,
            };
          }

          const folderPath = path.join(directory, entry.name);
          const images = (await readdir(folderPath, { withFileTypes: true }))
            .filter((file) => file.isFile() && allowed.has(path.extname(file.name).toLowerCase()))
            .map((file) => file.name)
            .sort((a, b) => a.localeCompare(b));
          if (images.length === 0) return null;

          const findThemeImage = (theme: "dark" | "light") =>
            images.find((file) => new RegExp(`^${theme}\\.(avif|jpe?g|png|webp)$`, "i").test(file));
          const darkFile = findThemeImage("dark") ?? images[0];
          const lightFile = findThemeImage("light") ?? darkFile;
          const imageUrl = (file: string) =>
            `/wallpapers/${encodeURIComponent(entry.name)}/${encodeURIComponent(file)}`;

          return {
            file: entry.name,
            name: prettyName(entry.name),
            url: imageUrl(lightFile),
            darkUrl: imageUrl(darkFile),
            lightUrl: imageUrl(lightFile),
          };
        }),
    );

    return NextResponse.json({ wallpapers: wallpapers.filter((wallpaper) => wallpaper !== null) });
  } catch {
    return NextResponse.json({ wallpapers: [] });
  }
}
