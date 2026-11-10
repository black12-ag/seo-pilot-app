import { INSTALL_COMMAND } from "./landingLinks";

export const navLinks = [
  ["Idea", "#idea"],
  ["Features", "#features"],
  ["Free", "#free"],
  ["Install", "#install"],
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
