# Fonts for the share card

`Geist-Regular.ttf`, `Geist-Bold.ttf` and `Fraunces-Bold.woff`, used only by
`src/app/api/pledges/[token]/card.png/route.tsx` and
`src/app/api/og/default.png/route.tsx` to draw the WhatsApp share card and the
default link preview. They are not served to browsers and are not part of the
site's own typography.

The site already loads Geist through `next/font/google` in `src/app/layout.tsx`,
and Fraunces in `src/lib/fonts.ts`, and that is still where the typefaces on the
pages come from. These files exist because the image routes cannot use them:
`next/font/google` delivers woff2, and Satori, the renderer behind `next/og`,
reads ttf, otf and woff but not woff2. The same typefaces therefore have to
arrive twice, in two formats, for two renderers.

Static weights rather than variable files, because Satori picks a face out of
the list it is given by weight and does not interpolate a variable axis. A
variable file would render every weight at its default instance, which is the
regular, and the bold on the card would silently not be bold.

## Geist

Taken from the `geist` package on npm, version 1.7.2, at
`dist/fonts/geist-sans/`. Copied in rather than depended on: the package is 5 MB
and ships every weight of two families for a `next/font` integration this
project does not use, against 250 KB for the two files actually needed.

Licensed under the SIL Open Font License 1.1, copyright 2023 Vercel in
collaboration with basement.studio. `LICENSE.txt` beside this file is the full
text and has to stay with the fonts.

## Fraunces

`Fraunces-Bold.woff` is `files/fraunces-latin-700-normal.woff` from the
`@fontsource/fraunces` package on npm, version 5.3.0, renamed. Latin subset,
static 700. It sets "This is My Pledge", the reference and the project name on
the images, all bold, so there is no regular: nothing on either image is
Fraunces at 400, and an unused face is only bundle weight.

Licensed under the SIL Open Font License 1.1, copyright 2020 The Fraunces
Project Authors. `LICENSE-Fraunces.txt` beside this file is the full text, taken
from the same package, and has to stay with the font.
