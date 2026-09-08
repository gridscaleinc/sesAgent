import type { Metadata } from 'next'
import { siteCopy, sitePath, type LegalSection, type SiteLocale, type SitePage } from './site-content'

const localeOrder: SiteLocale[] = ['en', 'ja', 'zh']
const localeShortLabel: Record<SiteLocale, string> = { en: 'EN', ja: '日本語', zh: '中文' }

export function metadataFor(locale: SiteLocale, page: SitePage): Metadata {
  const copy = siteCopy[locale]
  const title = page === 'home' ? 'SES Agent Desktop' : page === 'privacy' ? copy.privacy.title : copy.terms.title
  const description = page === 'home' ? copy.home.lead : page === 'privacy' ? copy.privacy.summary : copy.terms.summary
  return { title, description }
}

function Header({ locale, page }: { locale: SiteLocale; page: SitePage }) {
  const copy = siteCopy[locale]
  return (
    <header className="site-header">
      <a className="brand" href={sitePath(locale, 'home')} aria-label="SES Agent Desktop home">
        <span className="brand-mark">S</span><span>SES Agent Desktop</span>
      </a>
      <nav aria-label="Primary navigation">
        <a href={`${sitePath(locale, 'home')}#gmail`}>{copy.nav.google}</a>
        <a aria-current={page === 'privacy' ? 'page' : undefined} href={sitePath(locale, 'privacy')}>{copy.nav.privacy}</a>
        <a aria-current={page === 'terms' ? 'page' : undefined} href={sitePath(locale, 'terms')}>{copy.nav.terms}</a>
      </nav>
      <div className="language-links" aria-label={copy.languageLabel}>
        {localeOrder.map((item) => item === locale
          ? <strong key={item}>{localeShortLabel[item]}</strong>
          : <a href={sitePath(item, page)} hrefLang={siteCopy[item].htmlLang} key={item}>{localeShortLabel[item]}</a>)}
      </div>
    </header>
  )
}

function Footer({ locale }: { locale: SiteLocale }) {
  const copy = siteCopy[locale]
  return (
    <footer className="site-footer">
      <div><strong>SES Agent Desktop</strong><span>{copy.footer.operatedBy}</span></div>
      <nav aria-label="Legal navigation">
        <a href={sitePath(locale, 'privacy')}>{copy.nav.privacy}</a>
        <a href={sitePath(locale, 'terms')}>{copy.nav.terms}</a>
        <a href="mailto:app_user01@gridscale.com">{copy.nav.contact}</a>
      </nav>
      <small>{copy.footer.copyright}</small>
    </footer>
  )
}

export function HomePage({ locale }: { locale: SiteLocale }) {
  const copy = siteCopy[locale]
  return (
    <div className="site-shell" lang={copy.htmlLang}>
      <Header locale={locale} page="home" />
      <main>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">{copy.home.eyebrow}</p><h1>{copy.home.headline}</h1><p className="hero-lead">{copy.home.lead}</p>
            <div className="trust-row" aria-label="Product safeguards">{copy.home.trust.map((item) => <span key={item}>{item}</span>)}</div>
          </div>
          <aside className="scope-card" id="gmail">
            <p className="card-label">{copy.home.connectionLabel}</p><h2>{copy.home.connectionTitle}</h2>
            <dl>{copy.home.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          </aside>
        </section>
        <section className="principles" aria-labelledby="principles-title">
          <div className="section-heading"><div><p className="eyebrow">{copy.home.processEyebrow}</p><h2 id="principles-title">{copy.home.processTitle}</h2></div></div>
          <div className="principle-grid">{copy.home.steps.map((step, index) => <article key={step.title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{step.title}</h3><p>{step.body}</p></article>)}</div>
        </section>
        <section className="data-callout">
          <div><p className="eyebrow">{copy.home.dataEyebrow}</p><h2>{copy.home.dataTitle}</h2></div>
          <p>{copy.home.dataBody}</p><a className="text-link" href={sitePath(locale, 'privacy')}>{copy.home.privacyLink} <span aria-hidden="true">→</span></a>
        </section>
      </main>
      <Footer locale={locale} />
    </div>
  )
}

function LegalSectionView({ section }: { section: LegalSection }) {
  return (
    <section className="legal-section">
      <h2>{section.title}</h2>
      {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {section.bullets ? <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul> : null}
    </section>
  )
}

export function LegalPage({ locale, page }: { locale: SiteLocale; page: Exclude<SitePage, 'home'> }) {
  const copy = siteCopy[locale]
  const document = copy[page]
  return (
    <div className="site-shell legal-shell" lang={copy.htmlLang}>
      <Header locale={locale} page={page} />
      <main className="legal-main">
        <header className="legal-hero"><p className="eyebrow">SES AGENT DESKTOP</p><h1>{document.title}</h1><p>{document.summary}</p><time dateTime="2026-09-01">{document.updated}</time></header>
        <div className="legal-layout">
          <aside><strong>{page === 'privacy' ? copy.nav.privacy : copy.nav.terms}</strong><a href={sitePath(locale, page === 'privacy' ? 'terms' : 'privacy')}>{page === 'privacy' ? copy.nav.terms : copy.nav.privacy}</a><a href="mailto:app_user01@gridscale.com">app_user01@gridscale.com</a></aside>
          <article className="legal-document">{document.sections.map((section) => <LegalSectionView key={section.title} section={section} />)}</article>
        </div>
      </main>
      <Footer locale={locale} />
    </div>
  )
}
