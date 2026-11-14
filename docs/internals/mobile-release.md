# Archiving and uploading the mobile app

You sign, archive and upload from Xcode with your own Apple Developer account.
The steps below are all on your machine. Nothing in the repo holds signing
credentials.

## Once

1. In [App Store Connect](https://appstoreconnect.apple.com), create the app:
   - **Platform:** iOS
   - **Bundle ID:** `dev.capsule.mobile`, or your own (see step 3)
   - **SKU:** anything unique
   - **Primary language:** English
2. Open `apps/ios/Capsule.xcodeproj` in Xcode.
3. Select the **Capsule** target → **Signing & Capabilities**:
   - Tick **Automatically manage signing** and choose your **Team**.
   - If `dev.capsule.mobile` is taken or not yours, change **Bundle Identifier**.
     Also change `PRODUCT_BUNDLE_IDENTIFIER` in `apps/ios/project.yml`, so a
     later `xcodegen generate` keeps it.
   - Do the same for the **CapsuleWidgets** target (`dev.capsule.mobile.widgets`;
     it must stay a child of the app's identifier).
   - Likewise **CapsuleShare** (`dev.capsule.mobile.share`).
   - All three targets use the App Group `group.dev.capsule.mobile.shared`. With automatic
     signing Xcode registers it for your team. If you changed the identifiers,
     change the group in both `.entitlements` files and in `SharedStore.group`
     (`Capsule/Shared/CapsuleActivity.swift`).
4. Fill in App Privacy in App Store Connect. The app collects no data and has
   no tracking or third-party SDKs; `Capsule/Resources/PrivacyInfo.xcprivacy`
   says the same. The only required-reason API it uses is `UserDefaults`
   (reasons `CA92.1`, and `1C8F.1` for the App Group the widget reads). The
   widget extension has its own manifest declaring `1C8F.1`.
5. Export compliance: `ITSAppUsesNonExemptEncryption` is `NO`. The app uses
   only the system's TLS.

## Each release

1. Bump **Version** (`MARKETING_VERSION`) and **Build**
   (`CURRENT_PROJECT_VERSION`) in `project.yml`, then run `xcodegen generate`.
   Or change them in the target's **General** tab and copy them back into
   `project.yml`.
2. Run the tests: **Product → Test** (⌘U) with an iPhone simulator selected.
3. Choose **Any iOS Device (arm64)** as the run destination.
4. Choose **Product → Archive**. The Organizer opens when it finishes.
5. Choose **Distribute App** → **App Store Connect** → **Upload**. Keep
   **Upload your app's symbols** and **Manage version and build number**
   ticked, then choose **Upload**.
6. In App Store Connect → **TestFlight**, wait for processing. Add yourself as
   an internal tester and try the build on a phone against your computer.
7. In the version page, attach the build, then add:
   - screenshots for 6.9″ iPhone and 13″ iPad
   - the description
   - a support URL
   - the privacy policy URL
8. Submit for review.

## Notes for App Review

The app does nothing without a Capsule desktop to pair with. Give reviewers a
short note like this:

> Capsule for iPhone pairs with the Capsule desktop app on the same network.
> To review it, install Capsule on a Mac, open Settings → Gateway → Browser
> access, set the reach to "This network", choose "Pair a phone", and scan the
> code with this app. A demo video is attached.

A screen recording of pairing and a live thread saves a rejection round trip.
Reviewers without a Mac can also tap **Try a sample workspace** on the
welcome screen. It shows every main screen with made-up data and sends
nothing.

Set the privacy policy URL in App Store Connect to the published privacy
page. The app's **Settings → About → Privacy policy** link reads
`CapsulePrivacyPolicyURL` in `Capsule/Resources/Info.plist`, which points to
`PRIVACY.md` on GitHub by default. Change it there if the policy lives on
your own site.

The signing team is set in Xcode under Signing & Capabilities.
`DEVELOPMENT_TEAM` is empty in `project.yml` on purpose, so the repo carries
no account details.

## What the build already has

- An app icon (light, dark and tinted) and a launch screen in
  `Capsule/Resources/Assets.xcassets`.
- Usage strings for the camera (QR scanning and photos), the local network
  (connecting to the computer), and the microphone and speech recognition
  (on-device dictation), all in `InfoPlist.xcstrings` as well.
- App Transport Security on the defaults, plus `NSAllowsLocalNetworking`,
  which allows connections to the computer's local address. That exception
  needs no justification in review.
- Background fetch, for checks that post local notifications.
- `NSSupportsLiveActivities`, and a widget extension with the Live Activity
  and a Home Screen and Lock Screen widget.
- iPhone and iPad, all orientations on iPad.
