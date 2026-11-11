# NEXVADORAQ HireHub — Play Store AAB ತಯಾರಿ

## Workflow
GitHub Actions ಮೂಲಕ Capacitor Android project ಸಿದ್ಧಪಡಿಸಿ, Android 16 / API 36 ಗುರಿಯೊಂದಿಗೆ Signed Android App Bundle (.aab) ನಿರ್ಮಿಸಲು ಈ workflow ಸೇರಿಸಲಾಗಿದೆ. ಯಶಸ್ವಿಯಾದ AAB ಅನ್ನು 14 ದಿನಗಳವರೆಗೆ artifact ಆಗಿ ಉಳಿಸಲಾಗುತ್ತದೆ.

## ಮಾಲೀಕರು ಮಾಡಬೇಕಾದ ಸುರಕ್ಷಿತ Signing Setup
Google Play upload key ಅನ್ನು ಖಾಸಗಿಯಾಗಿ ಸೃಷ್ಟಿಸಿ. Keystore ಅಥವಾ password ಅನ್ನು GitHub repositoryಗೆ commit ಮಾಡಬೇಡಿ.

GitHub → Repository → Settings → Secrets and variables → Actions → New repository secret ನಲ್ಲಿ ಈ secrets ಸೇರಿಸಿ:
1. ANDROID_KEYSTORE_BASE64 — upload keystore ಫೈಲ್‌ನ base64 ಪಠ್ಯ
2. ANDROID_KEYSTORE_PASSWORD — keystore password
3. ANDROID_KEY_ALIAS — key alias
4. ANDROID_KEY_PASSWORD — key password

Windows PowerShell:
[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload-keystore.jks"))

macOS/Linux:
base64 -w 0 upload-keystore.jks

Signing key ಮತ್ತು passwords ಅನ್ನು ಸುರಕ್ಷಿತವಾಗಿ backup ಮಾಡಿ. ಯಾರೊಂದಿಗೂ ಹಂಚಿಕೊಳ್ಳಬೇಡಿ. GitHub Actions log ಅಥವಾ source codeನಲ್ಲಿ secrets ಮುದ್ರಿಸಬೇಡಿ.

## Build ಚಾಲನೆ
1. GitHub repository → Actions ತೆರೆಯಿರಿ.
2. NEXVADORAQ HireHub - Play Store AAB ಆಯ್ಕೆಮಾಡಿ.
3. Run workflow ಒತ್ತಿರಿ.
4. Build ಯಶಸ್ವಿಯಾದರೆ run pageನ Artifacts ವಿಭಾಗದಿಂದ NEXVADORAQ-HireHub-PlayStore-AAB ಡೌನ್‌ಲೋಡ್ ಮಾಡಿ.

## ಇನ್ನೂ ಮಾಲೀಕರು ಪೂರ್ಣಗೊಳಿಸಬೇಕಾದವು
- Google Play Console Developer Account, identity verification ಮತ್ತು registration fee.
- Firebase native FCMಗೆ ಅಗತ್ಯವಿದ್ದರೆ GOOGLE_SERVICES_JSON_BASE64 secret.
- Privacy Policy, Data Safety, App access, content rating, account deletion URL ಮತ್ತು Store Listing.
- Location/background location, camera, notification permissionsಗಳನ್ನು ನೈಜ ಬಳಕೆ ಮತ್ತು Play policyಗೆ ಅನುಗುಣವಾಗಿ ಪರಿಶೀಲಿಸುವುದು.
- ಹೊಸ Personal developer accountಗೆ ಕನಿಷ್ಠ 12 testers ನಿರಂತರವಾಗಿ 14 ದಿನ Closed Testingನಲ್ಲಿ opt-in ಆಗಿರಬೇಕಾಗಬಹುದು.

ಈ workflow ಸೇರಿಸಿರುವುದರಿಂದ ಮಾತ್ರ AAB build ಯಶಸ್ವಿಯಾಗಿದೆ ಎಂದರ್ಥವಲ್ಲ. GitHub Actions run pass ಆದ ನಂತರವೇ AAB ಲಭ್ಯ ಎಂದು ಪರಿಗಣಿಸಬೇಕು.
