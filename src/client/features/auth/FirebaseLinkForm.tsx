import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SectionHeader } from "@/client/components/PageHeader";
import { Input } from "@/client/components/ui/input";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { submitFirebaseIdentity } from "./firebaseAuth";
import { signUpStatusQueryOptions } from "./signUpStatus";

export function FirebaseLinkForm() {
  const { data } = useQuery(signUpStatusQueryOptions());
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!data?.googleSignIn) return null;
  async function link() {
    setBusy(true);
    setMessage(null);
    try {
      await submitFirebaseIdentity(password);
      setPassword("");
      setMessage("Google is linked. You can use it the next time you sign in.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to link Google.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="max-w-sm space-y-3">
      <SectionHeader title="Google sign-in" />
      <p className="text-sm text-muted-foreground">
        Confirm your current password, then choose Google with the same email
        address.
      </p>
      <label className="block text-sm" htmlFor="google-link-password">
        Current password
      </label>
      <Input
        id="google-link-password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={busy}
      />
      <GoogleSignInButton
        label="Link Google"
        isBusy={busy}
        disabled={!password}
        onClick={() => {
          void link();
        }}
      />
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}
