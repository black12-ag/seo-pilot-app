import {
  firebasePublicConfigSchema,
  firebaseResultSchema,
} from "@/shared/firebase-auth";

async function googleFirebaseToken() {
  const response = await fetch("/api/firebase-config", { cache: "no-store" });
  if (!response.ok) throw new Error("Google sign-in is unavailable.");
  const body: unknown = await response.json();
  const config = firebasePublicConfigSchema.parse(
    body && typeof body === "object" && "config" in body ? body.config : null,
  );
  const [appSDK, authSDK] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const name = `openseo-auth-${config.projectId}`;
  const app =
    appSDK.getApps().find((candidate) => candidate.name === name) ??
    appSDK.initializeApp(config, name);
  const auth = authSDK.getAuth(app);
  // SEO uses its HttpOnly session; do not persist Firebase credentials here.
  await authSDK.setPersistence(auth, authSDK.inMemoryPersistence);
  const provider = new authSDK.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    const credential = await authSDK.signInWithPopup(auth, provider);
    return await credential.user.getIdToken(true);
  } finally {
    await authSDK.signOut(auth);
  }
}

export async function submitFirebaseIdentity(password?: string) {
  const idToken = await googleFirebaseToken();
  const response = await fetch(
    `/api/auth/${password === undefined ? "sign-in" : "link"}/firebase`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        idToken,
        ...(password === undefined ? {} : { password }),
      }),
    },
  );
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    const message =
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string"
        ? error.message
        : "Google sign-in is unavailable. Please try again.";
    throw new Error(message);
  }
  firebaseResultSchema.parse(await response.json());
}
