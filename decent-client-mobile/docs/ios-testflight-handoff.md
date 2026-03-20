# iOS TestFlight uploader handoff

This is the short handoff for whoever has Apple Developer / App Store Connect access.

## Repo-side status

Already prepared in the repo:
- iOS privacy strings for camera and microphone
- URL scheme scaffolding for `decentchat` and `app.decentchat.mobile`
- `App.entitlements` scaffold wired into the Xcode project
- iOS app version aligned to `0.1.0`
- initial build number set to `1`

## Before first upload

1. Open `ios/App/App.xcodeproj` in full Xcode
2. Select the **App** target
3. Set the correct **Team** under Signing & Capabilities
4. Confirm bundle identifier is correct: `app.decentchat.mobile`
5. Confirm signing succeeds with valid certificate/profile
6. Create or confirm the App Store Connect app record exists
7. If push is in scope, enable **Push Notifications** capability and add the real APNs entitlement/setup
8. If associated domains or auth callbacks are needed, add those capabilities and identifiers now

## Candidate build steps

1. Build web assets / sync iOS shell if needed
   - `npm run ios:build`
2. Open Xcode
   - `npm run ios:open`
3. Set the candidate build number in Xcode (`CURRENT_PROJECT_VERSION`)
4. Archive the app
   - Product → Archive
5. Upload the archive to App Store Connect
6. Wait for TestFlight processing to complete
7. Post the candidate handoff in the release thread with:
   - build/version
   - environment
   - commit/branch
   - upload status
   - iOS/release owner + timestamp

## Compact candidate thread template

- **Build/version:**
- **Environment:** staging / prod
- **Commit / branch:**
- **Upload status:** pending / uploaded / processing / ready
- **iOS / Release owner:**
- **Apple / App Store Connect status:** READY / BLOCKED
- **Backend status:** READY / BLOCKED
- **QA status:** GO / NO-GO
- **Blockers:**
- **Next owner / next action:**

## Notes

- The iOS shell files are now selectively trackable in git; generated `ios/App/App/public/` assets stay ignored.
- Increment the build number for every new TestFlight upload.
- Apple-account steps cannot be completed from repo automation alone.
