// rule: server-sequential-independent-await
// weakness: library-idiom
// source: fresh modern-corpus FP hunt (Next.js 15 request-scoped async APIs)
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

declare const db: { findCounter: (id: number) => Promise<number> };

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string>>;
}

export default async function Page(props: PageProps) {
  const t = await getTranslations("CurrentCount");
  const headersList = await headers();
  const id = Number(headersList.get("x-e2e-random-id")) || 0;
  const count = await db.findCounter(id);
  const searchParams = await props.searchParams;
  const { slug } = await props.params;
  return (
    <main>
      <h1>{t("title")}</h1>
      <p>
        {slug}: {count} ({searchParams.view})
      </p>
    </main>
  );
}
