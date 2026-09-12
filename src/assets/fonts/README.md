# Fonts for the share card

`Geist-Regular.ttf` and `Geist-Bold.ttf`, used only by
`src/app/api/pledges/[token]/card.png/route.tsx` to draw the WhatsApp share
card. They are not served to browsers and are not part of the site's own
typography.

The site already loads Geist through `next/font/google` in `src/app/layout.tsx`,
and that is still where the typeface on the pages comes from. These files exist
because that route cannot use it: `next/font/google` delivers woff2, and Satori,
the renderer behind `next/og`, reads ttf, otf and woff but not woff2. The same
typeface therefore has to arrive twice, in two formats, for two renderers.

Two static weights rather than `Geist-Variable.ttf`, because Satori picks a face
out of the list it is given by weight and does not interpolate a variable axis.
A variable file would render every weight at its default instance, which is the
regular, and the bold on the card would silently not be bold.

Taken from the `geist` package on npm, version 1.7.2, at
`dist/fonts/geist-sans/`. Copied in rather than depended on: the package is 5 MB
and ships every weight of two families for a `next/font` integration this
project does not use, against 250 KB for the two files actually needed.

Licensed under the SIL Open Font License 1.1, copyright 2023 Vercel in
collaboration with basement.studio. `LICENSE.txt` beside this file is the full
text and has to stay with the fonts.
