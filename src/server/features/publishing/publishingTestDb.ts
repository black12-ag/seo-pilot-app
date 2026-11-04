export const publishingOrigin = "https://example.com";

const challengeId = "30000000-0000-4000-8000-000000000003";

/** A verified site on the seeded project, valid until far in the future. */
export const verifiedAuthoritySql = (origin = publishingOrigin) => `
  INSERT INTO site_authority_challenges (id,project_id,authority_version,origin,method,nonce,status,issued_at_ms,expires_at_ms,next_check_at_ms,attempts_used,checked_at_ms,evidence_sha256)
    VALUES ('${challengeId}','project',1,'${origin}','http_file','${"n".repeat(43)}','verified',1,2,1,1,1,'${"e".repeat(64)}');
  INSERT INTO project_site_authority (project_id,origin,version,status,current_challenge_id,verified_at_ms,verified_until_ms,updated_at_ms)
    VALUES ('project','${origin}',1,'verified','${challengeId}',1,9000000000000,1);`;

export const grantedConnectionSql = (
  sealed = "sealed",
  origin = publishingOrigin,
) => `
  INSERT INTO wordpress_connections (project_id,origin,credential_id,sealed_credential,read_status,write_status,read_checked_at_ms,write_checked_at_ms,created_by_user_id,created_at_ms,updated_at_ms)
    VALUES ('project','${origin}','credential','${sealed}','granted','granted',1,1,'user',1,1);`;

/** An approved review of the seeded revision, as the claim statements read it. */
export const approvedReviewSql = () => `
  INSERT INTO content_mutations (id,project_id,mutation_id,request_hash,kind,result_id,completed,created_at_ms)
    VALUES ('review-receipt','project','review','hash','review','request',1,1);
  INSERT INTO content_review_requests (id,project_id,content_id,revision_id,check_set_id,mutation_receipt_id,assignee_user_id,requested_by_user_id,version,state,context_version,created_at_ms,sequence)
    VALUES ('request','project','content','revision','checks','review-receipt','user','user',2,'approved',0,1,1);
  UPDATE content_items SET review_version = 1 WHERE id = 'content';`;

export const heldApproval = {
  requestId: "request",
  requestVersion: 2,
  headVersion: 1,
};

export const publishingScope = {
  organizationId: "organization",
  userId: "user",
  role: "owner",
  requireMembership: true,
};
