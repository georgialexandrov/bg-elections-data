import type { ReactNode } from "react";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { fonts } from "./fonts.js";

const WIDTH = 1200;
const HEIGHT = 630;

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
