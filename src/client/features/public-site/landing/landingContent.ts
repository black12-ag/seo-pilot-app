import { INSTALL_COMMAND } from "./landingLinks";

export const navLinks = [
  ["Idea", "#idea"],
  ["Features", "#features"],
  ["Free", "#free"],
  ["Install", "#install"],
  ["Connect", "#connect"],
] as const;

export const roles = ["Audit", "Rank", "Track", "Cite"];

export const marqueeWords = [
  "Audit Every Page",
  "Track Real Rankings",
  "Own Your Data",
  "Know What AI Says",
  "Free And Open Source",
];

export const principles = [
  {
    title: "Free where the data is yours",
    text: "Audits come from our own crawler. Rankings, clicks and keyword ideas come from your Search Console. None of it needs a paid key.",
  },
  {
    title: "Never a made-up number",
    text: "When there's no honest source for a number, the page says so instead of guessing. Competitor data stays an optional key.",
  },
  {
    title: "Your server, your keys",
    text: "SEO Pilot runs on your machine with your Google account. Nothing is sent to us, because there is no us in the middle.",
  },
  {
    title: "One command to run it",
    text: "A single install script writes the settings, downloads the ready-made image and starts everything. Updating is the same command.",
  },
];

export const features = [
  {
    name: "Site Audit",
    category: "Technical SEO",
    tag: "Free",
    blurb:
      "Our crawler reads every page the way a search engine does and keeps each check as evidence you can compare later.",
    visual: "audit",
  },
  {
    name: "Rank Tracking",
    category: "Search Console",
    tag: "Free",
    blurb:
      "Your real average Google position for every keyword, every day, with the last 30 days filled in the moment you add it.",
    visual: "rank",
  },
  {
    name: "AI Visibility",
    category: "Your own AI login",
    tag: "Free",
    blurb:
      "Ask your tracked questions through your signed-in agy, claude or codex and see if your brand is mentioned, and which sources are cited.",
    visual: "ai",
  },
  {
    name: "Backlinks",
    category: "Common Crawl",
    tag: "Free",
    blurb:
      "Which sites link to you and your competitors, from Common Crawl's free public web graph, refreshed with one monthly command.",
    visual: "links",
  },
] as const;

export const stats = [
  ["1", "Command to install"],
  ["$0", "Subscription, ever"],
  ["2 GB", "Memory it needs"],
  ["MIT", "Open-source license"],
] as const;

export const installOptions = [
  {
    name: "One command",
    detail: "Any computer with Docker",
    text: "Downloads SEO Pilot, creates its settings with new secrets and starts it on port 3001.",
    command: INSTALL_COMMAND,
  },
  {
    name: "With your AI",
    detail: "agy, claude or codex",
    text: "Also starts the AI engine on the AI login already signed in on this computer, for SAM, drafts and AI visibility.",
    command: `${INSTALL_COMMAND} -s -- --with-ai`,
  },
  {
    name: "On your domain",
    detail: "Your own HTTPS address",
    text: "Sets the public address so Google sign-in and Search Console links point at your domain.",
    command: `${INSTALL_COMMAND} -s -- --url https://seo.example.com`,
  },
];

export const connectSteps = [
  {
    title: "Search Console and Analytics",
    text: "Create a free Google login for your copy once, then add your Google account and pick each site's property. Or use Import my sites to add them all at once.",
    where: "Project → GSC Insights → Add Google account",
    guide: "SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md",
  },
  {
    title: "Continue with Google",
    text: "Let people sign in with Google. An existing account with the same verified email links itself on the first Google sign-in.",
    where: "Sign-in page",
    guide: "GOOGLE_SIGN_IN.md",
  },
  {
    title: "Your AI login",
    text: "Sign in to agy, claude or codex on your computer and install with --with-ai, or add an OpenRouter key. Switch any time in Settings.",
    where: "Settings → AI engine",
    guide: "AI_ENGINE.md",
  },
  {
    title: "Your own domain",
    text: "Put SEO Pilot on an HTTPS address like seo.example.com, so Google sign-in and Search Console point at it.",
    where: "install.sh --url",
    guide: "PUBLISH_ON_YOUR_DOMAIN.md",
  },
  {
    title: "Rankings and backlinks",
    text: "Rank tracking fills in from Search Console on its own. Backlinks need one monthly command that downloads Common Crawl's free data.",
    where: "Rank Tracking · Backlinks",
    guide: "FREE_RANKINGS.md",
  },
  {
    title: "Updates and backups",
    text: "Run the install command again with --update for a new version. The guide covers backups and every setting.",
    where: "install.sh --update",
    guide: "SELF_HOSTING_SEO_PILOT.md",
  },
];
