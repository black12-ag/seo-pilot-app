import { HELP_PATHS } from "@/shared/product-help";

export function getAgentSetupPrompt(origin: string) {
  return `Help me connect this agent to my SEO Pilot instance at ${origin}/mcp.

First identify this client and its supported remote HTTP MCP configuration. Preserve existing integrations. Follow the setup guide at ${origin}${HELP_PATHS.agent}. Use the instance endpoint, not a hosted plugin endpoint. For an authenticated instance, use OAuth if supported or create an API key at ${origin}/settings and configure an Authorization: Bearer header in the client's secret settings. Never ask me to paste a key into chat or commit it. A no-auth local deployment may not need a key; Cloudflare Access and Every App have their own access requirements.

Reload if needed and verify using whoami and list_projects only when available. Report the connection result. Do not claim success before verification or run paid research during setup. Google and research providers require their own configuration.`;
}
