# Add "Continue with Google"

With accounts on (`AUTH_MODE=password`), people can also sign in with Google. It uses a free Firebase project. The free Spark plan is enough; you don't need billing.

## 1. Set up Firebase

1. In the [Firebase console](https://console.firebase.google.com/), create a project.
2. Open **Authentication → Get started → Sign-in method**, turn on **Google**, choose a support email and save.
3. Open **Authentication → Settings → Authorized domains** and add your SEO Pilot address, such as `seo.example.com`.
4. Open **Project settings → Your apps**, add a **Web** app, and copy its `apiKey`, `authDomain`, `projectId` and `appId`.

## 2. Give SEO Pilot the settings

In `deploy/standalone/.env`:

```dotenv
FIREBASE_API_KEY=your-api-key
FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
FIREBASE_PROJECT_ID=your-project
FIREBASE_APP_ID=your-app-id
```

Run your usual `docker compose ... up -d` command again. The sign-in page then shows **Continue with Google**.

These four values are public by design: every visitor's browser receives them.

## 3. Use it

- **Existing account:** press **Continue with Google** with the same email address. Google has already verified that email, so it links to your account on the first sign-in. Your password keeps working too.
- **New people:** invite their Google email address first. Sign-ups stay closed otherwise.

"Sign in with Google" is separate from connecting Search Console and Analytics. Those ask for their own Google permission in the app. See [Search Console](SELF_HOSTING_GOOGLE_SEARCH_CONSOLE.md) and [Analytics](SELF_HOSTING_GOOGLE_ANALYTICS.md).
