import type { ReactNode } from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { fonts } from "./fonts.js";

const WIDTH = 1200;
const HEIGHT = 630;

/** Convert a raw SVG string to a base64 PNG data URI (for embedding in Satori <img>). */
export function svgToPngDataUri(svg: string, width = 560): string {
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  const pngData = resvg.render().asPng();
  const base64 = Buffer.from(
    pngData.buffer,
    pngData.byteOffset,
    pngData.byteLength,
  ).toString("base64");
  return `data:image/png;base64,${base64}`;
}

/** Render a satori JSX element to a PNG buffer. */
export async function renderOgImage(element: ReactNode): Promise<Buffer> {
  const svg = await satori(element as React.JSX.Element, {
    width: WIDTH,
    height: HEIGHT,
    fonts,
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: WIDTH },
  });
  const pngData = resvg.render().asPng();
  return Buffer.from(pngData.buffer, pngData.byteOffset, pngData.byteLength);
}
