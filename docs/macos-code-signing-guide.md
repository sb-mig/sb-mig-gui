# macOS Code Signing & Notarization Guide

This guide explains how to set up macOS code signing and notarization for distributing the sb-mig GUI app without Gatekeeper warnings.

## Why is this needed?

When users download an app from the internet (like from GitHub releases), macOS Gatekeeper blocks it unless it's:

1. **Code signed** with an Apple Developer ID certificate
2. **Notarized** by Apple

Without this, users see: _"App can't be opened because Apple cannot check it for malicious software"_

---

## Prerequisites

- **Apple Developer Account** ($99/year) - [developer.apple.com](https://developer.apple.com)
- **macOS** with Keychain Access
- **GitHub repository** with Actions enabled

---

## Step 1: Create Certificates in Apple Developer Portal

### 1.1 Go to Certificates Page

1. Sign in to [developer.apple.com/account](https://developer.apple.com/account)
2. Click **Certificates, Identifiers & Profiles**
3. Click **Certificates** in the sidebar
4. Click the **+** button to create a new certificate

### 1.2 Create Developer ID Application Certificate

1. Scroll to **Software** section
2. Select **Developer ID Application**
3. Click **Continue**
4. Select **G2 Sub-CA (Xcode 11.4.1 or later)**
5. Click **Continue**

### 1.3 Create Certificate Signing Request (CSR)

1. Open **Keychain Access** on your Mac (search in Spotlight)
2. Go to menu: **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority...**
3. Fill in:
   - **User Email Address**: Your Apple ID email
   - **Common Name**: Your name
   - **CA Email Address**: Leave empty
   - **Request is**: Select **Saved to disk**
4. Click **Continue**
5. Save the `.certSigningRequest` file

### 1.4 Upload CSR and Download Certificate

1. Back in Apple Developer portal, click **Choose File**
2. Select your `.certSigningRequest` file
3. Click **Continue**
4. Click **Download** to get the `.cer` file

### 1.5 Install Certificate

1. Double-click the downloaded `.cer` file
2. It will open in Keychain Access and install automatically

> **Tip**: If double-click doesn't work, try dragging the `.cer` file into Keychain Access

### 1.6 (Optional) Create Developer ID Installer Certificate

Repeat steps 1.2-1.5 but select **Developer ID Installer** instead. This is used for signing `.pkg` installers.

> **Note**: You'll need to create a NEW CSR for each certificate - you can't reuse the same CSR!

---

## Step 2: Export Certificate as .p12

### 2.1 Find Your Certificate

1. Open **Keychain Access**
2. Click **login** in the sidebar
3. Click **My Certificates** tab
4. Find **"Developer ID Application: YOUR NAME"**

> **Important**: The certificate should have a small arrow (▶) you can expand, showing a private key underneath. If there's no private key, the certificate won't work!

### 2.2 Export as .p12

1. Right-click on **"Developer ID Application: YOUR NAME"**
2. Click **Export...**
3. Choose format: **Personal Information Exchange (.p12)**
4. Save the file (e.g., `DeveloperIDApplication.p12`)
5. Set a strong password - **remember this password!**

### 2.3 Convert to Base64

Open Terminal and run:

```bash
base64 -i ~/Downloads/DeveloperIDApplication.p12 -o ~/Desktop/certificate-base64.txt
```

The content of `certificate-base64.txt` will be added to GitHub Secrets.

---

## Step 3: Create App-Specific Password

Apple requires an app-specific password for notarization (you can't use your regular Apple ID password).

1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in with your Apple ID
3. Go to **Sign-In and Security** → **App-Specific Passwords**
4. Click the **+** button
5. Name it something like "sb-mig-gui notarization"
6. Click **Create**
7. **Copy the password** (format: `xxxx-xxxx-xxxx-xxxx`)

> **Important**: Save this password somewhere secure - you can't see it again!

---

## Step 4: Find Your Team ID

1. Go to [developer.apple.com/account](https://developer.apple.com/account)
2. Look at the top right or go to **Membership Details**
3. Copy your **Team ID** (10-character string like `BBDY3ZEHGH`)

---

## Step 5: Add GitHub Secrets

Go to your GitHub repository:

1. Click **Settings**
2. Click **Secrets and variables** → **Actions**
3. Click **New repository secret**

Add these 5 secrets:

| Secret Name                  | Value                               | Example                             |
| ---------------------------- | ----------------------------------- | ----------------------------------- |
| `APPLE_CERTIFICATE`          | Content of `certificate-base64.txt` | `MIIKkAIBAzCCCkoGCS...` (very long) |
| `APPLE_CERTIFICATE_PASSWORD` | Password from step 2.2              | `MySecureP@ssw0rd`                  |
| `APPLE_ID`                   | Your Apple ID email                 | `you@example.com`                   |
| `APPLE_ID_PASSWORD`          | App-specific password from step 3   | `xxxx-xxxx-xxxx-xxxx`               |

> **Note:** Team ID is hardcoded in `package.json` under `build.mac.notarize.teamId` - no secret needed!

---

## Step 6: Configure electron-builder

### 6.1 Update package.json

Add notarization config to the `mac` section in `package.json`:

```json
{
  "build": {
    "mac": {
      "category": "public.app-category.developer-tools",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist",
      "notarize": {
        "teamId": "${env.APPLE_TEAM_ID}"
      }
    }
  }
}
```

### 6.2 Create Entitlements File

Create `build/entitlements.mac.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.debugger</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
    <key>com.apple.security.automation.apple-events</key>
    <true/>
</dict>
</plist>
```

---

## Step 7: Configure GitHub Actions Workflow

The release workflow needs to import the certificate before building. Here's the key part:

```yaml
- name: Import Code Signing Certificate
  env:
    APPLE_CERTIFICATE: ${{ secrets.APPLE_CERTIFICATE }}
    APPLE_CERTIFICATE_PASSWORD: ${{ secrets.APPLE_CERTIFICATE_PASSWORD }}
  run: |
    # Create a temporary keychain
    KEYCHAIN_PATH=$RUNNER_TEMP/app-signing.keychain-db
    KEYCHAIN_PASSWORD=$(openssl rand -base64 32)

    # Decode certificate
    echo "$APPLE_CERTIFICATE" | base64 --decode > $RUNNER_TEMP/certificate.p12

    # Create keychain
    security create-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH
    security set-keychain-settings -lut 21600 $KEYCHAIN_PATH
    security unlock-keychain -p "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH

    # Import certificate
    security import $RUNNER_TEMP/certificate.p12 -P "$APPLE_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k $KEYCHAIN_PATH
    security list-keychain -d user -s $KEYCHAIN_PATH

    # Allow codesign to access the certificate
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" $KEYCHAIN_PATH

- name: Build macOS
  run: npm run dist:mac
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    APPLE_ID: ${{ secrets.APPLE_ID }}
    APPLE_ID_PASSWORD: ${{ secrets.APPLE_ID_PASSWORD }}
    APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
```

---

## Troubleshooting

### Certificate won't import (Error -25294)

- The private key from the CSR might be missing
- **Solution**: Revoke the certificate in Apple Developer portal and create a new one with a fresh CSR

### "Certificate is not trusted" in Keychain

- This is usually fine - the certificate will still work for signing
- If it causes issues, make sure you have the Apple Worldwide Developer Relations Certificate installed

### Notarization fails

- Check that your Apple ID and app-specific password are correct
- Ensure your Team ID matches the certificate
- Check the Apple notarization logs for specific errors

### Build works locally but fails in CI

- Make sure all 5 GitHub secrets are set correctly
- Check that the base64 encoding doesn't have any extra whitespace or newlines

---

## Quick Reference

### Files to commit

- `build/entitlements.mac.plist` ✅
- `package.json` (with notarize config) ✅

### Files NOT to commit

- `.p12` certificate file ❌
- `certificate-base64.txt` ❌
- Any passwords ❌

### GitHub Secrets needed

1. `APPLE_CERTIFICATE`
2. `APPLE_CERTIFICATE_PASSWORD`
3. `APPLE_ID`
4. `APPLE_ID_PASSWORD`

> Team ID is hardcoded in `package.json` - no secret needed! 3. `APPLE_ID` 4. `APPLE_ID_PASSWORD` 5. `APPLE_TEAM_ID`

---

## Resources

- [Apple Developer Documentation](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [electron-builder Notarization](https://www.electron.build/configuration/mac#notarization)
