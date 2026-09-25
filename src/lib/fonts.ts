import { Fraunces } from "next/font/google";

/**
 * The display serif for public headings, matching the camp meeting site and
 * the printed campaign material.
 *
 * Loaded here rather than in the root layout so only the (site) layout
 * preloads the file. The admin portal never names it and never downloads it.
 *
 * Variable, with only the opsz axis added to the default wght: display sizes
 * get the display cut. SOFT and WONK are left at their defaults and not
 * loaded, since each extra axis grows the file. No italic.
 *
 * Money figures are deliberately not set in this face. The served file has no
 * tnum feature, so tabular-nums is silently ignored and a counting total would
 * change width every frame; those stay in Geist, which has it.
 */
export const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  adjustFontFallback: true,
});
