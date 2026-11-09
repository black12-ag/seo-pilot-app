import { createFileRoute } from "@tanstack/react-router";
import { LEGAL_CONTACT_EMAIL, legalPageResponse } from "@/shared/legalPage";

const body = `
<p>This policy explains what SEO Pilot collects, why, who receives it and what you can do about it. "We" means whoever operates this SEO Pilot workspace. To reach us, email <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a>.</p>

<h2>What we collect</h2>
<table>
<tr><th>Data</th><th>Details</th><th>Why</th></tr>
<tr><td>Account</td><td>Name, email, profile picture if you sign in with Google, hashed password, your organization and role, invitations</td><td>To sign you in and run your workspace</td></tr>
<tr><td>Sessions</td><td>IP address, browser user agent, sign-in time</td><td>To keep your account secure</td></tr>
<tr><td>Setup answers</td><td>What you told us when you started, such as your interests and how you found us</td><td>To set up your workspace</td></tr>
<tr><td>Your projects</td><td>Websites, business details, competitors, key pages, keywords, rankings, backlinks, audit results</td><td>To provide the features you use</td></tr>
<tr><td>AI work</td><td>Prompts you track, AI answers and their sources, chats with SAM, research results</td><td>To provide AI visibility and assistant features</td></tr>
<tr><td>Content</td><td>Briefs, sources, drafts, revisions, reviews, reports</td><td>To write, review and share your content</td></tr>
<tr><td>Connections</td><td>Google access tokens and the account email, WordPress username and application password, crawler credentials, API keys</td><td>To reach the services you connect</td></tr>
</table>

<h2>Who receives your data</h2>
<p>We don't sell your data. We send data to these services only when a feature needs it. Each one handles it under its own terms.</p>
<table>
<tr><th>Service</th><th>What it receives</th></tr>
<tr><td>DataForSEO</td><td>Keywords, domains, URLs, locations and AI prompts you research or track</td></tr>
<tr><td>OpenRouter and the AI companies it routes to, or whichever AI provider the operator connected (Google, Anthropic or OpenAI)</td><td>SAM chats, project details, page text and sources used for research and drafts, AI prompts you track or explore when the AI engine answers them, and results from tools SAM uses for you. This can include Search Console and Google Analytics data if you ask SAM about it. These companies may keep this data under their own terms</td></tr>
<tr><td>The AI tool this workspace chooses (Antigravity from Google, Claude Code from Anthropic, or Codex from OpenAI), if it doesn't use OpenRouter</td><td>The same AI data as OpenRouter, handled under that tool's own terms and the operator's plan with that company. These companies may keep this data, and free plans may use it to improve their products</td></tr>
<tr><td>Google</td><td>Sign-in details, your Search Console and Analytics requests, map views, and the domains whose icons we show, sent directly from your browser</td></tr>
<tr><td>Google PageSpeed Insights</td><td>Addresses of the pages an audit samples for page speed, if you turn that on and this workspace has no DataForSEO key. Google then loads those pages itself</td></tr>
<tr><td>Ahrefs</td><td>Domains shown in the Backlinks table, to look up their public rating</td></tr>
<tr><td>Context.dev</td><td>URLs of pages that need rendering, if enabled</td></tr>
<tr><td>Cloudflare</td><td>Domains we check for site verification. If this workspace runs on Cloudflare, also everything it stores and processes</td></tr>
<tr><td>IndexNow (Bing and others)</td><td>Your site and the URLs you choose to submit</td></tr>
<tr><td>WordPress</td><td>Your login details and the draft you send, to your own site only</td></tr>
</table>
<p><strong>Only on workspaces that sell paid plans:</strong> Autumn and Stripe for billing and cards, Loops for email, Cloudflare Turnstile to stop automated sign-ups, PostHog for product analytics and masked session replay, and Dub and Meta for referrals and advertising. Where these run, you can change analytics, referral and advertising choices in Settings. They default off in the EEA, UK and Switzerland and where your location is unknown, and on elsewhere until you opt out.</p>

<h2>Google data</h2>
<p>Connecting Google gives read-only access to the Search Console and Analytics properties you choose. We use that data only to show it to you and analyze it for you. We don't sell it, use it for advertising, or use it to train AI models. If you ask SAM about it, the relevant data goes to the AI provider to answer you. You can disconnect at any time, and we revoke access when the last connection is removed.</p>

<h2>Sites we visit</h2>
<p>When you run an audit, our crawler visits that site's public pages as <code>SEO-Pilot-Audit/1.0</code>. It follows <code>robots.txt</code> and slows down when a site asks. Other single requests you trigger, such as reading your site during setup or capturing a source page, identify themselves as SEO Pilot but don't check <code>robots.txt</code>.</p>

<h2>Cookies and browser storage</h2>
<p>We use cookies to keep you signed in, remember your privacy choices and remember the sidebar's state. Your browser also stores preferences such as your theme, filters and recent searches. These stay on your device. Workspaces that sell paid plans may also use the analytics, referral and advertising cookies described above.</p>

<h2>How long we keep it</h2>
<ul>
<li>AI runs and answers: 13 months</li>
<li>Research log: 90 days</li>
<li>Sign-in sessions: 7 days</li>
<li>Invitations: 7 days</li>
<li>AI agent connections: access for 24 hours, renewal for 30 days</li>
<li>Everything else, including audits, rankings, reports, content and chats: until you or we delete it</li>
</ul>
<p>Deleting a project archives it and doesn't erase its data. To erase it, ask us. Report share links work until you revoke them, and anyone with the link can read that report.</p>

<h2>How we protect it</h2>
<p>Passwords are hashed. API keys are stored as hashes. Google tokens, WordPress passwords and crawler credentials are encrypted by the app. Other data, including emails, reports, chats and content, isn't separately encrypted by the app, so it relies on the security of the server it runs on. No system is perfectly secure.</p>

<h2>Your choices and rights</h2>
<p>Email us to get a copy of your data, correct it, or delete your account and data. We reply within 30 days, and we may need to confirm it's you. If you share an organization with other people, some of its data may stay with them. Copies in backups last until those backups are replaced, and we keep what the law requires. Depending on where you live, you may also object to some uses, or complain to your data protection authority.</p>
<p>Where the law requires a legal basis, ours is providing the service you asked for, our legitimate interest in keeping it secure and working, your consent where we ask for it, and legal duties.</p>

<h2>Where data goes</h2>
<p>The services above may process data in the United States and other countries, so your data may leave your country.</p>

<h2>Children</h2>
<p>SEO Pilot is for people 18 or older. We don't knowingly collect children's data. If you think we have, tell us and we'll delete it.</p>

<h2>Changes</h2>
<p>If we change this policy, we update the date above and tell signed-in users in the app.</p>
`;

export const Route = createFileRoute("/privacy")({
  server: {
    handlers: {
      GET: () => legalPageResponse("Privacy Policy", body),
    },
  },
});
