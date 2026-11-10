import { ProductPreview } from "./ProductPreview";
import { REPO_URL } from "./landingLinks";
import {
  features,
  installOptions,
  marqueeWords,
  navLinks,
  principles,
  roles,
  stats,
} from "./landingContent";
import { Eyebrow, FeatureVisual, Liquid } from "./LandingParts";
import { ConnectSection } from "./ConnectSection";

export { INSTALL_COMMAND, REPO_URL } from "./landingLinks";

export function LandingPage() {
  return (
    <>
      <svg className="liquid-defs" aria-hidden="true" focusable="false">
        <filter id="liquid">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.009"
            numOctaves={2}
            result="noise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={1} />
        </filter>
      </svg>

      <div className="preloader" aria-hidden="true">
        <p className="preloader-brand">SEO Pilot</p>
        <p className="preloader-count">
          <span data-count>0</span>
          <span className="accent">%</span>
        </p>
      </div>

      <header className="site-nav">
        <nav aria-label="Main navigation">
          <a className="logo" href="#top" aria-label="SEO Pilot home">
            <span className="monogram">SP</span>
            <span className="logo-name">SEO Pilot</span>
          </a>
          <ul className="nav-links">
            {navLinks.map(([label, href]) => (
              <li key={href}>
                <a href={href}>{label}</a>
              </li>
            ))}
            <li>
              <a href={REPO_URL}>GitHub</a>
            </li>
          </ul>
          <div className="nav-end">
            <a className="pill-button" href="/sign-in">
              Sign in
            </a>
            <button
              className="burger"
              type="button"
              aria-label="Open menu"
              aria-expanded="false"
              aria-controls="mobile-menu"
              data-burger
            >
              <i />
              <i />
              <i />
            </button>
          </div>
        </nav>
        <div className="mobile-menu" id="mobile-menu" data-menu hidden>
          <ul>
            {navLinks.map(([label, href]) => (
              <li key={href}>
                <a href={href}>{label}</a>
              </li>
            ))}
            <li>
              <a href={REPO_URL}>GitHub</a>
            </li>
            <li>
              <a href="/sign-in">Sign in</a>
            </li>
          </ul>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-name">
          <div className="hero-top">
            <h2 className="hero-roles" aria-label={roles.join(", ")}>
              {roles.map((role) => (
                <span className="line" key={role} aria-hidden="true">
                  <span className="line-inner" data-hero-role>
                    {role}
                  </span>
                </span>
              ))}
            </h2>
            <div className="hero-desc" data-hero-desc>
              <p>
                Your own SEO and AI-search workspace. Audits, real Google
                rankings, keyword ideas, backlinks and AI visibility, on your
                server, free.
              </p>
              <a className="text-link" href="#install">
                Install in one command <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>

          <div className="hero-product" data-hero-product>
            <Liquid label="Rank Tracking in SEO Pilot, with example data">
              <ProductPreview />
            </Liquid>
          </div>
          <div className="hero-fade" aria-hidden="true" />

          <h1 className="hero-name" id="hero-name" aria-label="SEO Pilot">
            <span className="name-line" data-letters aria-hidden="true">
              SEO
            </span>
            <span className="name-line" data-letters aria-hidden="true">
              Pilot
            </span>
          </h1>

          <p className="scroll-cue" data-hero-cue>
            <span aria-hidden="true" />
            Scroll to enter
          </p>
        </section>

        <section className="marquee" aria-label="What SEO Pilot stands for">
          <div className="marquee-track">
            {[0, 1].map((copy) => (
              <div className="marquee-set" key={copy} aria-hidden={copy === 1}>
                {marqueeWords.map((word) => (
                  <span className="marquee-item" key={word}>
                    {word}
                    <i aria-hidden="true" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section id="idea" className="section idea">
          <div className="idea-left">
            <Eyebrow>The Idea</Eyebrow>
            <h2 className="heading heading-lg" data-lines>
              Your search data belongs to you.
            </h2>
            <p className="lead" data-reveal>
              SEO tools charge every month to show you numbers about your own
              website. Most of those numbers already live in your Google
              account. SEO Pilot brings them together on your own server, adds
              its own crawler and your own AI, and costs nothing to run.
            </p>
          </div>
          <ol className="principles">
            {principles.map((item, index) => (
              <li key={item.title} data-reveal data-delay={index * 90}>
                <span className="principle-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="section">
          <div className="section-head">
            <div>
              <Eyebrow>What It Does</Eyebrow>
              <h2 className="heading heading-lg narrow" data-lines>
                The work you check every week.
              </h2>
            </div>
            <p className="head-note">04 / Free features</p>
          </div>
          <ul className="features">
            {features.map((item, index) => (
              <li
                key={item.name}
                className={index % 2 === 1 ? "offset" : undefined}
                data-reveal
                data-delay={index % 2 === 1 ? 120 : 0}
              >
                <article className="feature">
                  <Liquid
                    label={`${item.name}, illustration with example data`}
                  >
                    <FeatureVisual kind={item.visual} />
                  </Liquid>
                  <div className="feature-row">
                    <div>
                      <h3>{item.name}</h3>
                      <p>{item.blurb}</p>
                    </div>
                    <p className="feature-meta">
                      <span>{item.category}</span>
                      <b>{item.tag}</b>
                    </p>
                  </div>
                </article>
              </li>
            ))}
          </ul>
          <p className="footnote">
            Illustrations use example data, not a real site.
          </p>
        </section>

        <section id="free" className="section">
          <div className="section-head">
            <div>
              <Eyebrow>By The Numbers</Eyebrow>
              <h2 className="heading" data-lines>
                Free, measured.
              </h2>
            </div>
          </div>
          <dl className="stats">
            {stats.map(([value, label], index) => (
              <div key={label} data-reveal data-delay={index * 110}>
                <dd>{value}</dd>
                <dt>{label}</dt>
              </div>
            ))}
          </dl>
          <div className="optional" data-reveal>
            <p>
              <b>Optional, pay-as-you-go:</b> search volume, competitor keywords
              and traffic, live rank checks for other sites and local map
              rankings come from a DataForSEO key, only if you want them.
            </p>
          </div>
        </section>

        <section id="install" className="section">
          <div className="section-head">
            <div>
              <Eyebrow>Install</Eyebrow>
              <h2 className="heading" data-lines>
                Pick how you run it.
              </h2>
            </div>
          </div>
          <div className="install" data-install>
            <ul className="install-list">
              {installOptions.map((option, index) => (
                <li key={option.name}>
                  <button
                    type="button"
                    className={index === 0 ? "active" : undefined}
                    aria-pressed={index === 0}
                    data-install-option={index}
                  >
                    <span className="install-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="install-name">
                      {option.name}
                      <small>{option.detail}</small>
                    </span>
                    <span className="install-rule" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="install-panels">
              {installOptions.map((option, index) => (
                <div
                  className="install-panel"
                  key={option.name}
                  data-install-panel={index}
                  hidden={index !== 0}
                >
                  <p className="install-text" data-words>
                    {option.text}
                  </p>
                  <pre className="terminal">
                    <code>
                      <span className="prompt" aria-hidden="true">
                        ${" "}
                      </span>
                      {option.command}
                    </code>
                  </pre>
                </div>
              ))}
            </div>
          </div>
        </section>

        <ConnectSection />

        <footer id="contact" className="contact">
          <Eyebrow>Run It Yourself</Eyebrow>
          <h2 className="heading heading-xl" data-lines>
            Have a site the world should find?
          </h2>
          <p className="lead" data-reveal>
            Install SEO Pilot today. You need Docker and about 2 GB of memory.
          </p>
          <a className="big-link" href={REPO_URL} data-reveal>
            github.com/black12-ag/seo-pilot-app
            <span className="accent" aria-hidden="true">
              ↗
            </span>
          </a>

          <div className="footer-bar">
            <div className="footer-sign">
              <p className="signature">SEO Pilot</p>
              <p className="tagline">Free software under the MIT license.</p>
            </div>
            <nav aria-label="Links">
              <ul className="footer-links">
                <li>
                  <a href={REPO_URL}>GitHub</a>
                </li>
                <li>
                  <a href="/privacy">Privacy</a>
                </li>
                <li>
                  <a href="/terms">Terms</a>
                </li>
              </ul>
            </nav>
            <p className="copyright">© 2026 SEO Pilot contributors.</p>
          </div>
        </footer>
      </main>
    </>
  );
}
