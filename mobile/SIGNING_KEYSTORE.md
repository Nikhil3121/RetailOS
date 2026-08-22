# Signing keystore — care and feeding

The Android signing keystore is a **one-way door**. Once we publish v1 to
Play Store signed by keystore `X`, every future update **must** be signed by
the same `X`. Lose the keystore and lose the ability to update the app on
Play Store — users would have to uninstall + reinstall from a new package
name, losing all their local data.

Treat this file the way you treat production database credentials. More so.

---

## The two paths

### Path A — Let EAS manage the keystore (recommended for a solo dev)

EAS Build stores the keystore in Expo's cloud, encrypted, tied to your
Expo account. First `eas build --platform android --profile production`
prompts you:

> No Android keystore found for project RetailOS. Would you like to
> generate one? (Y/n)

Say **Y**. EAS generates and stores it. From then on every build signs
with the same key automatically.

**Backup**: run once, save the output somewhere safe (1Password /
Bitwarden / a paper envelope in a fire safe):

```bash
eas credentials -p android
# choose the project → keystore → download
# saves keystore.jks + keystore-password.txt + key-alias.txt
```

Store those three files together. If you ever change Expo accounts, lose
account access, or want to hand the app to a client, this backup is what
lets you keep publishing updates.

### Path B — Manage the keystore yourself (Google Play App Signing)

Only pick this if you have a compliance reason to hold the key locally.
More operational overhead — you rotate, backup, and pass it into every
build manually.

```bash
# Generate the keystore (do this ONCE, ever, for this app)
keytool -genkey -v -keystore retailos-release.jks \
  -alias retailos -keyalg RSA -keysize 2048 -validity 10000

# Add to EAS credentials
eas credentials -p android
# choose "Set up a new keystore" → "Upload your own"
```

The `.jks` file, the store password, and the key alias password are ALL
required to re-sign. Missing any one = same as losing the whole thing.

---

## Immediate action items

1. **Never commit any keystore file to git.** `mobile/.gitignore` already
   ignores `*.jks` / `*.p12` / `*.key`. Verify before every commit.

2. **Never let the keystore live only on one machine.** Local disk failure
   = same effect as losing the passwords. Cloud backup (encrypted) or two
   physical devices minimum.

3. **Don't rotate the keystore.** For Android app signing, key rotation
   is a manual, permission-gated Play Console operation ("upgrade signing
   key") that requires the OLD key to authorise the swap. Only do this
   with a clear reason and full documentation.

4. **When onboarding a second developer**: they need EAS Build access
   (via `eas project:accesses`) — NOT a copy of the keystore itself.
   Expo hands them signing rights without ever exposing the key material.

---

## Play Store submission service account

Separate from the keystore, `eas submit --platform android` needs a
Google service-account JSON with `Service Account User` + `Release
manager` roles on the Play Console app.

1. Google Cloud Console → create service account → download JSON
2. Play Console → Settings → API access → grant the service account
   `Release manager` role on the RetailOS app
3. Save JSON as `mobile/google-play-service-account.json` (already in
   `.gitignore` under `*.key` / `*.p8` pattern; add explicitly if needed)

The JSON is referenced in `eas.json` under `submit.production.android.serviceAccountKeyPath`.

---

## Panic recovery drill

Once a quarter, verify you can still publish an update:

```bash
cd mobile
eas build --platform android --profile production
# should sign with the same keystore silently
```

If it fails, you've lost access. Fix immediately — waiting will only get
worse.
