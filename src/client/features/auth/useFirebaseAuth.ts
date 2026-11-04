import { useState } from "react";
import { submitFirebaseIdentity } from "./firebaseAuth";

export function useFirebaseAuth(redirectTo: string) {
  const [isStarting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setStarting(true);
    setError(null);
    try {
      await submitFirebaseIdentity();
      // The destination has already passed the app's auth redirect sanitizer.
      window.location.assign(redirectTo);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Google sign-in is unavailable.",
      );
      setStarting(false);
    }
  }
  return { isStarting, error, start };
}
