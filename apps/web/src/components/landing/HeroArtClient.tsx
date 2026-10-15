"use client";

// HeroArt as a client component: the server render still sets the SVG in
// the HTML, but the RSC payload carries only these props instead of the
// whole drawing a second time (#825). The art is seeded, so hydration
// draws the same boxes. The social card imports HeroArt itself.

import { HeroArt } from "./HeroArt";

export function HeroArtClient(props: { label: string; className?: string; themed?: boolean }) {
  return <HeroArt {...props} />;
}
