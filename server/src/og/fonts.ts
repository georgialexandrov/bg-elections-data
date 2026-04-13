import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const fontsDir = resolve(
  import.meta.dirname ?? dirname(fileURLToPath(import.meta.url)),
  "fonts",
);

export const geistRegular = readFileSync(
  resolve(fontsDir, "Geist-Regular.ttf"),
);
export const geistBold = readFileSync(resolve(fontsDir, "Geist-Bold.ttf"));
export const garamondBold = readFileSync(
  resolve(fontsDir, "EBGaramond-Bold.ttf"),
);

export const fonts = [
  { name: "Geist", data: geistRegular, weight: 400 as const },
  { name: "Geist", data: geistBold, weight: 700 as const },
  { name: "EB Garamond", data: garamondBold, weight: 700 as const },
];
