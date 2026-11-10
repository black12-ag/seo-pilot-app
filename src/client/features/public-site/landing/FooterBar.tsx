import { REPO_URL } from "./landingLinks";

export function FooterBar() {
  return (
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
            <a href="/docs/skills">Skills</a>
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
  );
}
