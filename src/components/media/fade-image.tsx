"use client";

import Image, { type ImageProps } from "next/image";

/**
 * A next/image that fades up once the file has actually arrived.
 *
 * The resting state is the finished state, exactly as the roadmap and the
 * progress bar are written: the image carries no opacity of its own, so if the
 * handler below never runs, the picture is simply there. That matters more
 * here than the fade does. An image held at zero opacity until JavaScript says
 * otherwise is an image that disappears when hydration fails or when the
 * browser painted it from cache before React ever attached a listener.
 *
 * So the attribute is what starts the animation rather than what ends it, and
 * it is set on the element rather than held in state: there is nothing to
 * re-render, and a page carrying six of these should not carry six state
 * updates to show them.
 */
export function FadeImage({ className, onLoad, ...props }: ImageProps) {
  return (
    // alt is not optional on ImageProps, so TypeScript already refuses a call
    // site without one. The rule only fires because it cannot see through the
    // spread.
    // eslint-disable-next-line jsx-a11y/alt-text
    <Image
      {...props}
      className={className ? `img-fade ${className}` : "img-fade"}
      onLoad={(event) => {
        event.currentTarget.dataset.loaded = "";
        onLoad?.(event);
      }}
    />
  );
}
