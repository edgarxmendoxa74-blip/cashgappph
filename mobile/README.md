# CashG Android app

The Android app wraps the web app from the repo root with [Capacitor](https://capacitorjs.com).
GitHub Actions builds it (`.github/workflows/android.yml`) on every push to `main`
that changes app files.

**Download the APK:** GitHub → **Actions** → **Android APK** → pick a run → **Artifacts**.

## Signing

Every APK must be signed with the same key, or phones can't install it as an update.
Add these repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
|---|---|
| `CASHG_KEYSTORE_BASE64` | the `.jks` keystore, base64-encoded |
| `CASHG_KEYSTORE_PASSWORD` | the keystore password |

Without them the workflow builds a debug APK, which works for testing only.
Keep a backup of the keystore and password. If they're lost, installed apps can't be updated.

## What the build changes

`sync-web.sh` copies the app files into `www/` and, for the APK only:

- bundles the Supabase library so the app starts offline;
- turns off the service worker, since the APK ships its own files.

`admin/` and `supabase/` are not included. The version is `1.0.<run number>`.

## Build on your own computer

Needs Node 22+, JDK 21 and the Android SDK (platform 36):

```bash
cd mobile
npm ci
bash sync-web.sh
npx cap add android
npx capacitor-assets generate --android
npx cap sync android
cd android && ./gradlew assembleDebug
```
