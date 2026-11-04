import { createFileRoute } from "@tanstack/react-router";
import {
  CommandBlock,
  helpLinkClassName,
  SecretHelpPage,
} from "@/client/features/help/SecretHelpPage";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

export const Route = createFileRoute("/_app/help/openrouter-api-key")({
  component: OpenrouterApiKeyHelpPage,
});

function OpenrouterApiKeyHelpPage() {
  const accountStep = (
    <li>
      Create an account at{" "}
      <a
        className={helpLinkClassName}
        href="https://openrouter.ai"
        target="_blank"
        rel="noreferrer"
      >
        openrouter.ai
      </a>{" "}
      and add credits (pay-as-you-go, like DataForSEO).
    </li>
  );
  const keyStep = (
    <li>
      Go to{" "}
      <a
        className={helpLinkClassName}
        href={OPENROUTER_KEYS_URL}
        target="_blank"
        rel="noreferrer"
      >
        OpenRouter API Keys
      </a>{" "}
      and click "Create API Key".
    </li>
  );
  return (
    <SecretHelpPage
      title="Set up AI"
      intro={
        <>
          AI features like SAM, the in-app SEO agent, need one of two things:
          the <code>OPENROUTER_API_KEY</code> secret below, or your own
          logged-in subscription on your server (Google, Anthropic or OpenAI),
          which you choose in Settings once <code>AI_ENGINE_URL</code> and{" "}
          <code>AI_ENGINE_TOKEN</code> are set. Setup for that route is in{" "}
          <code>docs/AI_ENGINE.md</code>. Both are optional: everything else in
          SEO Pilot works without them.
        </>
      }
      everyAppIntro="SAM, prompt suggestions and website research run on OpenRouter. On Every App the gateway holds the key once, for every app."
      secretName="OPENROUTER_API_KEY"
      steps={
        <>
          {accountStep}
          {keyStep}
          <li>
            Give the key to your deployment operator to configure using the
            applicable instructions below.
          </li>
        </>
      }
      everyAppSteps={
        <>
          {accountStep}
          {keyStep}
          <li>
            An owner or admin runs this from the Every App checkout and pastes
            the key:
            <CommandBlock command="pnpm everyapp secret set OPENROUTER_API_KEY" />
          </li>
          <li>Reload SEO Pilot.</li>
        </>
      }
      dashboardPasteStep="Paste your OpenRouter API key and save."
      terminalPromptHint="Paste your OpenRouter API key when prompted."
    />
  );
}
