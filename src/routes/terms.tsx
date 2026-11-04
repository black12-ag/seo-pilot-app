import { createFileRoute } from "@tanstack/react-router";
import { LEGAL_CONTACT_EMAIL, legalPageResponse } from "@/shared/legalPage";

const body = `
<p>These terms apply when you use SEO Pilot. By creating an account or using it, you agree to them. "We" means whoever operates this SEO Pilot workspace. To reach us, email <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a>. Our <a href="/privacy">Privacy Policy</a> explains how we handle data.</p>

<h2>Your account</h2>
<p>You must be at least 18 and able to agree to these terms. Keep your password and API keys private. You're responsible for what happens under your account and for the people you invite to your organization.</p>

<h2>Acceptable use</h2>
<p>Use SEO Pilot lawfully. You agree not to:</p>
<ul>
<li>audit, crawl or test a site in a way its owner hasn't allowed, or in a way that harms it</li>
<li>connect or publish to a site you don't have the right to change</li>
<li>break into, overload or get around the limits of SEO Pilot or any other service</li>
<li>use it to create spam, deception, or content that breaks the law or someone else's rights</li>
<li>resell access without our written agreement</li>
</ul>

<h2>Your content</h2>
<p>You keep ownership of what you put into SEO Pilot and what it produces for you. You give us permission to store and process it only as needed to run the service, including sending it to the providers listed in the Privacy Policy. You confirm you have the right to use the websites, sources and data you add.</p>

<h2>AI output</h2>
<p>AI drafts, answers and suggestions can be wrong, incomplete or out of date. Review them before you rely on or publish them. You're responsible for what you publish. Evidence and source checks help, but they don't prove something is true or legally safe.</p>

<h2>Connected services and costs</h2>
<p>Some features need outside services, such as DataForSEO, OpenRouter or another AI provider, Google or WordPress. Their own terms apply. Where you use your own keys, those providers bill you directly and we aren't responsible for their charges. Features that cost money say so before they run.</p>

<h2>Publishing and sharing</h2>
<p>You choose what gets sent to your site and what gets shared. WordPress publishing creates drafts for you to review. A report share link works for anyone who has it until you revoke it.</p>

<h2>Paid plans</h2>
<p>This section applies only if this workspace sells paid plans. Prices and included credits are shown before you buy. Subscriptions renew until you cancel, and you can cancel at any time. To get a subscription refund, email us within 30 days of the charge. If you turn on auto-reload, we charge your saved card when your credits run low, up to the limit you set.</p>

<h2>No guarantees</h2>
<p>We don't promise any ranking, traffic, AI citation or other result. Search engines and AI services decide those themselves. Scores and estimates are guides, not facts. SEO Pilot is provided "as is", and it may have errors or be unavailable at times. We don't give legal, financial or other professional advice.</p>

<h2>Liability</h2>
<p>To the extent the law allows, we aren't liable for indirect or consequential losses, such as lost profits, lost data or lost rankings. Our total liability is limited to what you paid us in the 12 months before the claim. Nothing here limits rights that the law says can't be limited.</p>

<h2>Ending use</h2>
<p>You can stop using SEO Pilot at any time and ask us to delete your data. We may suspend or close an account that breaks these terms or puts the service or others at risk.</p>

<h2>Changes</h2>
<p>If we change these terms, we update the date above and tell signed-in users in the app. Continuing to use SEO Pilot after accepting the update means you agree to the new version.</p>
`;

export const Route = createFileRoute("/terms")({
  server: {
    handlers: {
      GET: () => legalPageResponse("Terms of Service", body),
    },
  },
});
