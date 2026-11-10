import type { ReactNode } from "react";
import type { features } from "./landingContent";

export function Eyebrow({ children }: { children: string }) {
  return (
    <p className="eyebrow">
      <span className="eyebrow-dot" aria-hidden="true" />
      {children}
    </p>
  );
}

export function FeatureVisual({
  kind,
}: {
  kind: (typeof features)[number]["visual"];
}) {
  if (kind === "audit") {
    return (
      <div className="fv fv-audit" aria-hidden="true">
        <div className="fv-ring">
          <span>96</span>
          <small>SEO score</small>
        </div>
        <ul>
          <li>
            <b>48</b> pages assessed
          </li>
          <li>
            <b>0</b> errors
          </li>
          <li>
            <b>3</b> thin pages
          </li>
        </ul>
      </div>
    );
  }
  if (kind === "rank") {
    return (
      <div className="fv fv-rank" aria-hidden="true">
        <svg viewBox="0 0 300 120" preserveAspectRatio="none">
          <path
            d="M0,100 C30,96 50,92 70,84 S110,80 130,66 S170,58 190,44 S240,34 300,18"
            className="fv-line"
          />
        </svg>
        <p>
          <b>4.5</b> avg. position <em>↑ 9.5</em>
        </p>
      </div>
    );
  }
  if (kind === "ai") {
    return (
      <div className="fv fv-ai" aria-hidden="true">
        <p className="fv-q">Best tools to track my rankings?</p>
        <p className="fv-a">
          …Example Shop is a good pick for small sites<sup>1</sup>.
        </p>
        <p className="fv-tags">
          <span>Mentioned</span>
          <span>1 source cited</span>
        </p>
      </div>
    );
  }
  return (
    <div className="fv fv-links" aria-hidden="true">
      {[
        "news.example.org",
        "blog.example.net",
        "shop-reviews.example",
        "forum.example.io",
      ].map((site, index) => (
        <p key={site}>
          <span>{site}</span>
          <b>{[42, 17, 9, 4][index]}</b>
        </p>
      ))}
    </div>
  );
}

export function Liquid({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <figure className="liquid" data-liquid aria-label={label}>
      <div className="liquid-inner">{children}</div>
      <span className="liquid-glow" aria-hidden="true" />
    </figure>
  );
}
