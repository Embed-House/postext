"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import type { DocEntry } from "@/lib/docs";
import { docPart, partClass, type DocPart } from "@/lib/docParts";
import { docNumbers } from "@/lib/docNumbers";
import { cn } from "@/lib/utils";

const PART_LABEL_KEY = {
  foundations: "partFoundations",
  craft: "partCraft",
  practice: "partPractice",
} as const;

/** The docs as the guide's contents: grouped in parts, each part headed
 *  by a colour square and its tracked label, each chapter numbered in the
 *  part colour. The pages of a chapter ("3.2") are listed under it while
 *  the reader is in that chapter. Shared by the sidebar and the mobile
 *  menu. */
export function DocsPartsNav({ docs, onNavigate }: { docs: DocEntry[]; onNavigate?: () => void }) {
  const locale = useLocale();
  const pathname = usePathname();
  const t = useTranslations("Docs");

  const available = docs.filter((d) => d.locales[locale]);
  const numbers = docNumbers(available, locale);
  const parentOf = (doc: DocEntry) => {
    const parent = doc.locales[locale]!.parent;
    return parent && numbers.get(doc.slug)!.includes(".") ? parent : "";
  };
  const current = available.find((d) => pathname === `/${locale}/docs/${d.slug}`);
  const openChapter = current ? parentOf(current) || current.slug : "";
  const groups: { part: DocPart; docs: DocEntry[] }[] = [];
  for (const doc of available) {
    if (parentOf(doc)) continue;
    const part = docPart(doc.locales[locale]!.order);
    const last = groups[groups.length - 1];
    if (last && last.part.key === part.key) last.docs.push(doc);
    else groups.push({ part, docs: [doc] });
  }
  const pagesOf = (slug: string) => available.filter((d) => parentOf(d) === slug);

  const item = (doc: DocEntry, child: boolean) => {
    const meta = doc.locales[locale]!;
    const href = `/${locale}/docs/${doc.slug}`;
    const isActive = pathname === href;
    return (
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          "group flex min-h-10 items-center gap-2.5 rounded-e-md border-s-[3px] py-1 pe-2 font-sans transition-colors",
          child ? "ps-6 text-[0.75rem] 2xl:text-[0.8rem]" : "ps-3 text-[0.8rem] 2xl:text-sm",
          isActive
            ? "border-(--part) bg-surface font-semibold text-foreground"
            : "border-transparent text-slate hover:border-rule-strong hover:text-foreground",
        )}
      >
        <span className={cn("shrink-0 text-end font-bold text-(--part-ink) tabular-nums", child ? "w-7" : "w-5")}>{numbers.get(doc.slug)}</span>
        <span>{meta.sidebarTitle}</span>
      </Link>
    );
  };

  return (
    <div className="space-y-6">
      {groups.map(({ part, docs: partDocs }) => (
        <div key={part.key} className={partClass(part.color)}>
          <p className="kicker flex items-center gap-2 px-3 text-[0.6rem] tracking-[0.12em] whitespace-nowrap text-(--part-ink)">
            <span aria-hidden="true" className="size-2.5 shrink-0 bg-(--part)" />
            {t("part")} {part.number} · {t(PART_LABEL_KEY[part.key])}
          </p>
          <ul className="mt-2">
            {partDocs.map((doc) => {
              const pages = doc.slug === openChapter ? pagesOf(doc.slug) : [];
              return (
                <li key={doc.slug}>
                  {item(doc, false)}
                  {pages.length > 0 && (
                    <ul className="mb-1">
                      {pages.map((page) => (
                        <li key={page.slug}>{item(page, true)}</li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
