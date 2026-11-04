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
    // `h-[100dvh]` + `overflow-y-auto` makes this a scroll container, and the
    // auto-margin child centers when it fits but stays fully reachable (top and
    // bottom) when it's taller than the viewport. Plain `justify-center` clips
    // the overflow with no way to scroll to it.
    <div className="flex h-[100dvh] flex-col items-center overflow-y-auto bg-background p-4">
      <div className="m-auto flex w-full flex-col items-center">{children}</div>
    </div>
  );
}
