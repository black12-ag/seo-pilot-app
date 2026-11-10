import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { REPO_URL } from "../landing/landingLinks";

type PublicSkill = {
  name: string;
  description: string;
  instructions: string;
};

export function skillTitle(name: string) {
  return name
    .split("-")
    .map((word) =>
      word === "seo" || word === "gsc" || word === "ai"
        ? word.toUpperCase()
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}

function Header() {
  return (
    <header className="doc-nav">
      <a className="doc-logo" href="/welcome">
        <span className="monogram">SP</span>
        SEO Pilot
      </a>
      <nav aria-label="Main navigation">
        <a href="/docs/skills">Skills</a>
        <a href={REPO_URL}>GitHub</a>
        <a className="pill" href="/sign-in">
          Sign in
        </a>
      </nav>
    </header>
  );
}

function Footer() {
  return (
    <footer className="doc-footer">
      <p>SEO Pilot is free software under the MIT license.</p>
      <p>
        <a href="/welcome">Home</a> · <a href={REPO_URL}>GitHub</a> ·{" "}
        <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a>
      </p>
    </footer>
  );
}

export function SkillIndexPage({ skills }: { skills: PublicSkill[] }) {
  return (
    <>
      <Header />
      <main className="doc-main">
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          Skills
        </p>
        <h1>Workflows your AI can run.</h1>
        <p className="lead">
          Each skill is a step-by-step workflow for SEO Pilot's assistant, SAM,
          or any agent connected to SEO Pilot: Claude Code, Codex and others.
          They work without paid keys and never guess numbers. Write your own on
          the Skills page inside SEO Pilot.
        </p>
        <ul className="skill-list">
          {skills.map((skill) => (
            <li key={skill.name}>
              <a href={`/docs/skills/${skill.name}`}>
                <h2>{skillTitle(skill.name)}</h2>
                <p>{skill.description}</p>
              </a>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </>
  );
}

export function SkillPage({ skill }: { skill: PublicSkill }) {
  return (
    <>
      <Header />
      <main className="doc-main">
        <p className="eyebrow">
          <span className="dot" aria-hidden="true" />
          <a href="/docs/skills">Skills</a> / {skill.name}
        </p>
        <h1>{skillTitle(skill.name)}</h1>
        <p className="lead">{skill.description}</p>
        <div className="use-it">
          <p>
            <b>In SEO Pilot:</b> open SAM and ask it to run{" "}
            <code>{skill.name}</code>, or schedule it on the Skills page.
          </p>
          <p>
            <b>In Claude Code or Codex:</b> connect SEO Pilot's MCP server, then
            download this skill:{" "}
            <a href={`/docs/skills/${skill.name}?format=md`}>SKILL.md</a>.
          </p>
        </div>
        <article className="skill-body">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              // The page already has its h1; the skill's own headings step down.
              h1: ({ node: _node, ...props }) => <h2 {...props} />,
              h2: ({ node: _node, ...props }) => <h3 {...props} />,
            }}
          >
            {skill.instructions}
          </Markdown>
        </article>
      </main>
      <Footer />
    </>
  );
}
