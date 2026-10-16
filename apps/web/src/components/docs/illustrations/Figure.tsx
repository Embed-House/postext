import { useId, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { FigureZoom } from "./FigureZoom";

interface FigureProps {
  title: string;
  desc?: string;
  caption?: string;
  maxWidth?: number;
  viewBox: string;
  children: ReactNode;
}

export function Figure({ title, desc, caption, maxWidth = 760, viewBox, children }: FigureProps) {
  const t = useTranslations("Docs");
  const titleId = useId();
  const descId = useId();
  const drawnWidth = Number(viewBox.split(/[\s,]+/)[2]) || maxWidth;
  return (
    <figure className="docs-figure">
      <FigureZoom title={title} width={drawnWidth} enlargeLabel={t("figureEnlarge")} closeLabel={t("figureClose")}>
        <svg
          viewBox={viewBox}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-labelledby={desc ? `${titleId} ${descId}` : titleId}
          style={{ width: "100%", maxWidth: `${maxWidth / 18}rem`, fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
        >
          <title id={titleId}>{title}</title>
          {desc ? <desc id={descId}>{desc}</desc> : null}
          {children}
        </svg>
      </FigureZoom>
      {caption ? <figcaption className="docs-figcaption">{caption}</figcaption> : null}
    </figure>
  );
}
