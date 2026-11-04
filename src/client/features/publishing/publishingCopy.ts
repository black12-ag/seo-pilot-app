import type {
  PublishingRefusal,
  PublishState,
} from "@/types/schemas/publishing";

const refusals: Record<string, string> = {
  transport_unavailable:
    "Needs setup. This install can't reach WordPress with a password yet.",
  encryption_unavailable:
    "Needs setup. Set BETTER_AUTH_SECRET so the password can be stored safely.",
  site_not_verified: "Verify this site in Site authority first.",
  origin_mismatch:
    "That address isn't the site you verified. Use the exact verified address.",
  not_connected: "Connect WordPress first.",
  credential_unreadable:
    "The saved password can't be read. Connect WordPress again.",
  grant_missing: "Check read and write access first.",
  preview_changed: "This draft changed. Review the new preview.",
  title_missing: "Add a title to this content first.",
  not_ready: "Another request is working on this. Try again in two minutes.",
  check_too_soon:
    "It's too early to be sure. Check again in two minutes, and don't resend yet.",
  not_ours: "That post no longer holds our marker, so it was left alone.",
  not_a_draft: "That post is no longer a draft, so it was left alone.",
  owner_edited: "Someone edited that draft, so it was left alone.",
  baseline_missing:
    "We never confirmed this copy matches what we sent, so it was left alone. Manage it in WordPress.",
  record_erased:
    "This record's details were erased, so it can't be checked or moved from here. Manage it in WordPress.",
  post_missing: "That post is no longer on the site.",
  check_failed: "The site didn't answer. Nothing changed here. Try again.",
  remote_refused: "WordPress refused the request.",
  review_missing: "This content needs an approved review first.",
  review_not_approved: "This content needs an approved review first.",
  approval_withdrawn: "The approval was withdrawn.",
  head_changed: "There's a newer revision. Review it first.",
  context_changed: "Project details changed. Review this content again.",
  source_stale: "A source is out of date. Review this content again.",
  source_changed: "A source changed. Review this content again.",
  source_unavailable: "A source is no longer available.",
  checks_blocked: "A blocking check needs fixing first.",
  content_archived: "This content is archived.",
  revision_erased: "This revision was erased.",
};

export const refusalLabel = (reason: PublishingRefusal) =>
  refusals[reason] ?? `Not sent (${reason.replaceAll("_", " ")}).`;

export const stateLabels: Record<PublishState, string> = {
  sending: "Sending",
  uncertain: "Uncertain",
  not_found: "Not on the site",
  failed: "Refused",
  verified: "Verified draft",
  mismatch: "Differs from ours",
  trashing: "Moving to trash",
  trash_uncertain: "Trash uncertain",
  trashed: "In trash",
};

export const stateHelp: Record<PublishState, string> = {
  sending: "The request is on its way.",
  uncertain: "We don't know if this reached the site. Check before resending.",
  not_found: "The site doesn't have it. You can send it again.",
  failed: "WordPress refused it, so nothing changed. You can send it again.",
  verified: "We read it back from the site and it matches.",
  mismatch: "We read it back and it doesn't match.",
  trashing: "The request is on its way.",
  trash_uncertain: "We don't know if this moved to trash. Check again.",
  trashed: "It's in the WordPress trash and can be restored there.",
};
