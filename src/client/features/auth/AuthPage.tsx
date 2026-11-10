import { z } from "zod";
import { Button } from "@/client/components/ui/button";
import { GoogleSignInButton } from "./GoogleSignInButton";
import {
  getCurrentAuthRedirect,
  getOAuthSignedQuery,
} from "@/lib/auth-redirect";
import { isHostedClientAuthMode, usesBetterAuthClient } from "@/lib/auth-mode";
import { PRIVACY_URL, TERMS_URL } from "@/shared/terms";

export const authRedirectSearchSchema = z.object({
  redirect: z.string().optional(),
});

// The auth forms keep their pre-shadcn look: white inputs with 16px text, and a
// soft grey submit button.
export const authInputClassName =
  "border-foreground/20 bg-card text-base md:text-base";
export const authSubmitClassName =
  "w-full border-border bg-[color-mix(in_oklab,var(--card),var(--foreground)_8%)] font-semibold hover:bg-[color-mix(in_oklab,var(--card),var(--foreground)_12%)]";

export function useAuthPageState(redirect: string | undefined) {
  const redirectTo = getCurrentAuthRedirect(redirect);
  const oauthQuery =
    typeof window !== "undefined"
      ? getOAuthSignedQuery(window.location.search)
      : null;
  const isHostedMode = isHostedClientAuthMode();
  // Better Auth accounts exist (hosted or the standalone Docker edition), so
  // the email/password form can sign someone in.
  const isBetterAuthMode = usesBetterAuthClient();

  return {
    redirectTo,
    oauthQuery,
    isHostedMode,
    isBetterAuthMode,
  };
}

const termsLinkClassName =
  "text-foreground underline underline-offset-2 hover:text-foreground/80 transition-colors";

// Clickwrap: shown next to every button that can create an account, so
// clicking it is the affirmative acceptance the signup hook records.
export function TermsAgreementNotice({ action }: { action: string }) {
  return (
    <p className="text-center text-sm leading-relaxed text-muted-foreground">
      {action}, you agree to our{" "}
      <a
        href={TERMS_URL}
        target="_blank"
        rel="noreferrer"
        className={termsLinkClassName}
      >
        Terms
      </a>{" "}
      and{" "}
      <a
        href={PRIVACY_URL}
        target="_blank"
        rel="noreferrer"
        className={termsLinkClassName}
      >
        Privacy Policy
      </a>
      .
    </p>
  );
}

export function AuthMethodChooser({
  googleLabel,
  emailLabel = "Continue with email",
  isBusy,
  disabled,
  onContinueWithGoogle,
  onContinueWithEmail,
}: {
  googleLabel: string;
  emailLabel?: string;
  isBusy?: boolean;
  disabled?: boolean;
  onContinueWithGoogle: () => void;
  onContinueWithEmail: () => void;
}) {
  return (
    <div className="space-y-3">
      <GoogleSignInButton
        label={googleLabel}
        onClick={onContinueWithGoogle}
        disabled={disabled}
        isBusy={isBusy}
      />

      <Button
        type="button"
        variant="outline"
        className="w-full bg-card font-semibold dark:border-border dark:bg-card"
        onClick={onContinueWithEmail}
        disabled={disabled || isBusy}
      >
        {emailLabel}
      </Button>
    </div>
  );
}

export function AuthPageCard({
  title,
  helperText,
  children,
  footer,
}: {
  title: string;
  helperText?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-xs space-y-6">
      <div className="space-y-3 text-center">
        <img
          src="/transparent-logo.png"
          alt="SEO Pilot"
          className="mx-auto size-10 rounded-lg"
        />
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {helperText ? (
            <p className="mt-1 text-sm text-muted-foreground">{helperText}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4">{children}</div>

      {footer ? <div className="text-center">{footer}</div> : null}
    </div>
  );
}

export function AuthPageShell({ children }: { children: React.ReactNode }) {
  return (
    // The form side is a scroll container: its auto-margin child centers when
    // it fits and stays fully reachable when it's taller than the viewport.
    <div className="grid h-[100dvh] bg-background lg:grid-cols-[1.1fr_1fr]">
      <aside
        className="relative hidden overflow-hidden bg-[#f3f1ea] text-[#0c0c0e] lg:flex lg:flex-col lg:justify-between lg:p-10"
        aria-hidden="true"
      >
        <a
          href="/welcome"
          tabIndex={-1}
          className="flex items-center gap-3 text-[0.8125rem] font-medium uppercase tracking-[0.22em] text-[#6e6d66]"
        >
          <span className="grid size-10 place-items-center rounded-full border border-[rgba(12,12,14,0.22)] text-sm font-semibold tracking-tight text-[#0c0c0e]">
            SP
          </span>
          SEO Pilot
        </a>
        <div>
          <p className="flex items-center gap-3 text-[0.8125rem] font-medium uppercase tracking-[0.22em] text-[#6e6d66]">
            <span className="size-2 rounded-full bg-[#ff3b1d]" />
            Free and open source
          </p>
          <p className="mt-6 font-display text-[clamp(6rem,13vw,15rem)] uppercase leading-[0.82] tracking-[-0.01em] text-[#ff3b1d]">
            SEO
            <br />
            Pilot
          </p>
          <p className="mt-8 max-w-[28rem] text-[1.0625rem] leading-relaxed text-[#6e6d66]">
            Audits, real Google rankings, keyword ideas, backlinks and AI
            visibility, on your own server.
          </p>
        </div>
        <p className="text-[0.8125rem] uppercase tracking-[0.18em] text-[#6e6d66]">
          Audit · Rank · Track · Cite
        </p>
      </aside>
      <div className="flex flex-col items-center overflow-y-auto p-4">
        <div className="m-auto flex w-full flex-col items-center">
          <p
            className="mb-8 font-display text-5xl uppercase leading-none tracking-[-0.01em] text-[#ff3b1d] lg:hidden"
            aria-hidden="true"
          >
            SEO Pilot
          </p>
          {children}
        </div>
      </div>
    </div>
  );
}
