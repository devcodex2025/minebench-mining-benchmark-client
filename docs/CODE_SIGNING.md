# 🔐 Code Signing Guide for MineBench Client

> **Note:** this document predates the Tauri v2 migration. The current desktop client is **Tauri v2** (`src-tauri/tauri.conf.json`); signing is configured there (`bundle.windows.certificate*`, notarization for macOS) instead of `electron-builder`.

## Why Code Signing Matters

Code signing eliminates antivirus false positives by cryptographically proving that:
- The software comes from a verified publisher (you)
- The code hasn't been tampered with since signing
- Microsoft/Apple trust the publisher

**Without signing**: 5-30 antivirus engines flag as malware  
**With signing**: 0-2 engines flag (and users can verify it's safe)

## Cost & Options

### Windows Code Signing

#### Option 1: Standard Code Signing Certificate ($70-200/year)
- **Providers**: DigiCert, Sectigo, SSL.com
- **Process**: 
  - Purchase certificate (~$100-200/year for individuals, ~$70-150 for businesses)
  - Complete identity verification (1-3 days)
  - Receive certificate file (.pfx or .p12)
  - Use immediately

**Recommended**: SSL.com Code Signing Certificate ($179/year)
- Instant issuance for verified businesses
- Works with electron-builder
- SHA256 signing

#### Option 2: EV Code Signing Certificate ($300-400/year)
- **Benefits**: Instant SmartScreen reputation (no "unknown publisher" warnings)
- **Requirements**: Business verification, hardware token
- **Best for**: Commercial software with many users

### macOS Code Signing

**Apple Developer Account** ($99/year)
- Required for macOS app signing
- Includes Mac App Store distribution
- Notarization support (mandatory for macOS 10.15+)

## Setup Instructions

### Windows Signing

1. **Purchase Certificate**
   - Go to SSL.com or DigiCert
   - Choose "Code Signing Certificate"
   - Complete identity verification
   - Download `.pfx` file and password

2. **Store Certificate Securely**
   ```bash
   # Create secure folder (MineBench-Client root)
   mkdir certs
   
   # Copy certificate (NEVER commit to git)
   # Place your certificate at: certs/windows-cert.pfx
   ```

3. **Update .gitignore**
   Already configured to ignore `certs/` folder

4. **Configure electron-builder**
   
   **Option A: Environment Variables (Recommended for CI/CD)**
   ```bash
   # Windows PowerShell
   $env:CSC_LINK = "certs/windows-cert.pfx"
   $env:CSC_KEY_PASSWORD = "your-certificate-password"
   npm run dist:win
   ```

   **Option B: package.json (Local development only)**
   ```json
   "win": {
     "certificateFile": "certs/windows-cert.pfx",
     "certificatePassword": "your-password"  // DON'T commit this!
   }
   ```

5. **GitHub Actions Secrets (for automated builds)**
   - Go to repository Settings → Secrets → Actions
   - Add secrets:
     - `WINDOWS_CERT_BASE64`: Base64-encoded certificate
       ```bash
       # Windows PowerShell
       [Convert]::ToBase64String([IO.File]::ReadAllBytes("certs/windows-cert.pfx"))
       ```
     - `WINDOWS_CERT_PASSWORD`: Certificate password

6. **Update .github/workflows/release.yml**
   ```yaml
   # Add to Windows build step
   - name: Prepare Code Signing
     if: matrix.os == 'windows-latest'
     shell: pwsh
     run: |
       $certBytes = [Convert]::FromBase64String("${{ secrets.WINDOWS_CERT_BASE64 }}")
       [IO.File]::WriteAllBytes("$PWD\certs\windows-cert.pfx", $certBytes)
     env:
       CSC_LINK: certs/windows-cert.pfx
       CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CERT_PASSWORD }}
   ```

### macOS Signing

1. **Join Apple Developer Program**
   - Visit https://developer.apple.com
   - Enroll ($99/year)
   - Wait for approval (usually 24 hours)

2. **Create Certificates in Xcode**
   - Open Xcode → Preferences → Accounts
   - Add Apple ID
   - Manage Certificates → Create "Developer ID Application"

3. **Get Team ID**
   - Visit https://developer.apple.com/account
   - Copy your Team ID (10-character alphanumeric)

4. **Configure electron-builder**
   ```bash
   # Set environment variables
   export APPLE_ID="your-apple-id@email.com"
   export APPLE_ID_PASSWORD="app-specific-password"  # Generate in Apple ID settings
   export APPLE_TEAM_ID="YOUR10CHARS"
   ```

5. **Update package.json**
   ```json
   "mac": {
     "hardenedRuntime": true,
     "gatekeeperAssess": false,
     "entitlements": "build/entitlements.mac.plist",
     "entitlementsInherit": "build/entitlements.mac.plist"
   },
   "afterSign": "scripts/notarize.js"
   ```

## Verify Signing

### Windows
```powershell
# Check if executable is signed
Get-AuthenticodeSignature "dist\MineBench Client-0.2.8-Windows-x64-setup.exe"

# Should show:
# Status: Valid
# SignerCertificate: CN=Your Name/Company
```

### macOS
```bash
# Check signature
codesign -dvv "dist/MineBench Client-0.2.8-macOS-x64.dmg"

# Check notarization
spctl -a -vv -t install "dist/MineBench Client-0.2.8-macOS-x64.dmg"
```

## Budget Summary

### Minimal Setup (Windows only)
- **$150-200/year**: Standard Windows Code Signing Certificate
- **Result**: Eliminates most antivirus false positives on Windows

### Full Setup (Windows + macOS)
- **$270-300/year**: 
  - Windows Code Signing Certificate ($179/year)
  - Apple Developer Account ($99/year)
- **Result**: Professional-grade signing on all platforms

### Premium Setup (Immediate trust)
- **$400-500/year**:
  - EV Code Signing Certificate ($349/year)
  - Apple Developer Account ($99/year)
- **Result**: No SmartScreen warnings, instant trust

## Temporary Workaround (Free)

While saving for a certificate, users must manually add exceptions:

1. **Update README.md** with clear instructions (✅ Already done)
2. **Add disclaimer** to installer
3. **Publish SHA256 checksums** with each release
4. **VirusTotal scan** - link in release notes

## Next Steps

1. ✅ Update README with antivirus instructions
2. ✅ Configure NSIS installer settings
3. ⏳ Save $200 for code signing certificate
4. ⏳ Purchase certificate from SSL.com or DigiCert
5. ⏳ Set up GitHub Secrets for automated signing
6. ⏳ Create signed release and monitor false positive rate

## Resources

- [electron-builder Code Signing](https://www.electron.build/code-signing)
- [SSL.com Code Signing](https://www.ssl.com/code-signing/)
- [DigiCert Code Signing](https://www.digicert.com/signing/code-signing-certificates)
- [Apple Notarization](https://developer.apple.com/documentation/security/notarizing_macos_software_before_distribution)
