import Link from "next/link";

// Building blocks for the Notion-style pages in Study.

export function Crumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {trail.map((t, i) => (
        <span key={i} className="crumb">
          {i > 0 && <span className="sep">/</span>}
          {t.href ? <Link href={t.href}>{t.label}</Link> : <span className="here">{t.label}</span>}
        </span>
      ))}
    </nav>
  );
}
