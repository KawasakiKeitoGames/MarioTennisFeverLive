"use client";

import Link from "next/link";
import LangToggle from "../components/LangToggle";
import { useLang } from "../components/LocaleProvider";

// 連絡手段はXのDMのまま。リンク先はガメスのリンクまとめページに集約する。
const LINKS_URL = "https://games-desu.vercel.app/";

export default function AboutPage() {
  const { lang, t } = useLang();
  const en = lang === "en";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6 sm:py-10">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/"
          className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/5 px-3 py-1.5 text-xs font-bold text-brand shadow-sm transition-colors hover:bg-brand/10"
        >
          {t("nav.home")}
        </Link>
        <span className="ml-auto">
          <LangToggle />
        </span>
      </div>

      <h1 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
        {en ? (
          <>
            About <span className="text-brand">FEVER LIVE</span>
          </>
        ) : (
          <>
            FEVER LIVE <span className="text-brand">について</span>
          </>
        )}
      </h1>

      <div className="mt-4 space-y-5 rounded-2xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-700 shadow-sm sm:p-6">
        <section>
          <h2 className="mb-2 font-bold text-slate-800">{t("about.overviewH")}</h2>
          <p>{t("about.overview")}</p>
        </section>

        <section>
          <h2 className="mb-2 font-bold text-slate-800">{t("about.gamesH")}</h2>
          <p>{t("about.games")}</p>
        </section>

        <section>
          <h2 className="mb-2 font-bold text-slate-800">{t("about.featuresH")}</h2>
          <ul className="ml-5 list-disc space-y-1">
            <li>{t("about.f1")}</li>
            <li>{t("about.f2")}</li>
            <li>{t("about.f3")}</li>
            <li>{t("about.f4")}</li>
            <li>{t("about.f5")}</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 font-bold text-slate-800">{t("about.dataH")}</h2>
          <p>{t("about.data")}</p>
        </section>

        <section>
          <h2 className="mb-2 font-bold text-slate-800">{t("about.creatorH")}</h2>
          <p>{t("about.creator")}</p>
        </section>

        <section>
          <h2 className="mb-2 font-bold text-slate-800">{t("about.contactH")}</h2>
          <p>{t("about.contact")}</p>
          <p className="mt-2">
            <a
              href={en ? `${LINKS_URL}?lang=en` : LINKS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-bold text-brand underline"
            >
              {t("about.links")}
            </a>
          </p>
        </section>

        <section>
          <p className="text-xs text-slate-400">{t("common.disclaimer")}</p>
        </section>

        <p className="border-t border-slate-100 pt-4 text-xs text-slate-400">
          {t("about.updated")}
        </p>
      </div>
    </main>
  );
}
