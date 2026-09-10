/**
 * The momentum line on the hero tracker card.
 *
 * Inline SVG and nothing else. This sits on the page most people arrive at, and
 * pulling in a charting library for sixty pixels of line would put roughly
 * 100kB of JavaScript in front of somebody opening a WhatsApp link on a phone.
 * The points are computed on the server and baked into the markup, so this
 * costs one path and no script at all.
 *
 * Deliberately not a chart. No axes, no labels, no tooltip, no interaction. It
 * answers one question, whether the line is going up, and anybody who wants the
 * actual figures has the progress page.
 *
 * Amounts arrive as minor unit strings. They become numbers only to be turned
 * into coordinates, which is the point at which a figure has stopped being
 * money and become a pixel.
 */

/** Below this there is no line to draw, only a dot, which says nothing. */
const MIN_POINTS = 2;

const WIDTH = 300;
const HEIGHT = 40;
const STROKE = 1.5;

/**
 * The polyline geometry, or null when there is no line worth drawing.
 *
 * Pulled out of the component so it can be checked directly. The rule that
 * matters, that a flat run of days does not produce NaN coordinates, is
 * arithmetic rather than markup, and testing arithmetic through rendered JSX
 * means reaching into element props to find it.
 */
export function sparklinePoints(values: readonly string[]): string | null {
  if (values.length < MIN_POINTS) return null;

  const numbers = values.map((value) => Number(BigInt(value) / 100n));
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const span = max - min;

  /*
   * A flat month is the normal case early on, and dividing by a zero span would
   * put every point at NaN. A flat line drawn halfway up is the truthful
   * picture: nothing has moved.
   */
  const y = (value: number) =>
    span === 0
      ? HEIGHT / 2
      : // Inset by the stroke so the line is not clipped at either edge.
        HEIGHT - STROKE - ((value - min) / span) * (HEIGHT - STROKE * 2);

  const step = WIDTH / (numbers.length - 1);

  return numbers
    .map((value, index) => `${(index * step).toFixed(2)},${y(value).toFixed(2)}`)
    .join(" ");
}

export function Sparkline({
  values,
  className,
}: {
  /** Cumulative pledged, oldest first, as minor unit strings. */
  values: readonly string[];
  className?: string;
}) {
  const points = sparklinePoints(values);

  if (points === null) return null;

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      // Stretches to the card width and squashes to fit, which is what a
      // sparkline is for. The shape matters, not the aspect ratio.
      preserveAspectRatio="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
        // preserveAspectRatio="none" scales the stroke with the box, which
        // would fatten a 300 unit line stretched over 600 pixels.
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
