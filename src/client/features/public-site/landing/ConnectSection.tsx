import { connectSteps } from "./landingContent";
import { DOCS_URL } from "./landingLinks";
import { Eyebrow } from "./LandingParts";

export function ConnectSection() {
  return (
    <section id="connect" className="section">
      <div className="section-head">
        <div>
          <Eyebrow>Connect Your Accounts</Eyebrow>
          <h2 className="heading heading-lg narrow" data-lines>
            Link what you use, in minutes.
          </h2>
        </div>
        <p className="head-note">Step-by-step guides</p>
      </div>
      <ol className="connect">
        {connectSteps.map((step, index) => (
          <li key={step.title} data-reveal data-delay={index * 90}>
            <span className="principle-index">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
              <p className="connect-meta">
                <span>{step.where}</span>
                <a className="connect-link" href={`${DOCS_URL}/${step.guide}`}>
                  Read the guide <span aria-hidden="true">↗</span>
                </a>
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
