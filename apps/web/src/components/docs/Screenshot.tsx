import { useTranslations } from "next-intl";
import { NewTabNote } from "@/components/ui/NewTabNote";

interface ScreenshotProps {
  /** The picture, under `public/docs-shots/<locale>/`. */
  src: string;
  /** What the picture shows, for readers who cannot see it. */
  alt: string;
  caption?: string;
  /** The picture's own size in pixels. */
  width?: number;
  height?: number;
}

/** `<Screenshot src="/docs-shots/en/template.webp" alt="…" caption="…" />`:
 *  a capture of the Sandbox in the page's own language. It fits the column;
 *  the picture links to the file at its full size, which opens in a new tab,
 *  because the interface in it is small on a phone. */
export function Screenshot({ src, alt, caption, width = 1100, height = 707 }: ScreenshotProps) {
  const t = useTranslations("Docs");
  return (
    <figure className="docs-figure docs-shot">
      <a href={src} target="_blank" rel="noreferrer" className="docs-shot-link" title={t("figureEnlarge")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
        <NewTabNote />
      </a>
      {caption ? <figcaption className="docs-figcaption">{caption}</figcaption> : null}
    </figure>
  );
}
