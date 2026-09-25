import { Fraunces } from "next/font/google";

/**
 * The same face for the root 404 and 403 pages, without the preload.
 *
 * Those two files sit at the root of the app, so whatever they import is
 * preloaded on every route, the admin portal included. Without the preload
 * the file is fetched only when one of them actually renders its heading.
 *
 * next/font emits it under a different file name from the preloaded instance,
 * so a 404 whose header links prefetch the public pages can fetch the face
 * twice. That is 68 KB on a rare page, against 68 KB on every admin load.
 *
 * A module of its own, apart from fonts.ts: next/font preloads every face in
 * the modules a segment imports, so sharing that file would bring the
 * preloaded instance along with this one.
 */
export const frauncesStatus = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  adjustFontFallback: true,
  preload: false,
});
