# Build Configuration — Android and iOS

## Android: `android/app/build.gradle`

```gradle
android {
    namespace "com.picklejudge"
    compileSdk 36                 // Android 16 — required for new apps from 31 Aug 2026
    ndkVersion "27.2.12479018"

    defaultConfig {
        applicationId "com.picklejudge"
        minSdk 26                 // Android 8.0 — Camera2 maturity floor
        targetSdk 36              // MANDATORY for new Play submissions
        versionCode 1
        versionName "1.0.0"
        externalNativeBuild {
            cmake { cppFlags "-std=c++17 -O2 -frtti -fexceptions" }
        }
        ndk { abiFilters "arm64-v8a" }   // 32-bit is dead weight for this workload
    }

    externalNativeBuild {
        cmake { path "src/main/cpp/CMakeLists.txt"; version "3.22.1" }
    }

    signingConfigs {
        release {
            storeFile file(System.getenv("PBJ_KEYSTORE") ?: "release.keystore")
            storePassword System.getenv("PBJ_STORE_PASSWORD")
            keyAlias System.getenv("PBJ_KEY_ALIAS")
            keyPassword System.getenv("PBJ_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"),
                          "proguard-rules.pro"
        }
    }
    bundle { language { enableSplit false } }   // keep i18n in the base module
}
```

Ship an **AAB**, not an APK. Enable **Play App Signing** — Google holds the
signing key; losing your upload key becomes recoverable instead of fatal.

## Android: `AndroidManifest.xml` — the complete permission set

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
<uses-permission android:name="android.permission.VIBRATE" />

<uses-feature android:name="android.hardware.camera.any" android:required="true" />
<uses-feature android:name="android.hardware.camera.autofocus" android:required="false" />
```

Requesting anything beyond this — location, storage, contacts — triggers a
Play sensitive-permissions declaration and, for READ_CONTACTS specifically,
a flag under the policy that took effect 15 May 2026. You need none of them.

Keep the screen on during play (`FLAG_KEEP_SCREEN_ON`), not `WAKE_LOCK`.

## iOS: `Info.plist` purpose strings

Generic strings ("to use the app") are rejected under 5.1.1. These are
specific and true:

```xml
<key>NSCameraUsageDescription</key>
<string>PickleJudge analyses live video on this device to locate the ball and
determine where it bounced. Video is never stored or sent anywhere.</string>

<key>NSLocalNetworkUsageDescription</key>
<string>PickleJudge connects directly to your second phone on this Wi-Fi
network to combine both cameras' measurements. Only small numeric bounce
records are exchanged — never video.</string>

<key>NSBonjourServices</key>
<array>
  <string>_picklejudge._tcp</string>
</array>
```

`NSLocalNetworkUsageDescription` plus `NSBonjourServices` are both mandatory
for mDNS discovery on iOS 14+; omitting `NSBonjourServices` makes discovery
silently return nothing, which is a bug you will chase for a day.

## iOS: toolchain floor

Uploads to App Store Connect must be built with **Xcode 26 / iOS 26 SDK** or
later (in force since 28 Apr 2026). Set the *deployment target* to iOS 16 —
that is the practical floor for device coverage, and unrelated to the SDK you
build against.

## Engine wiring

Android — in `android/app/src/main/cpp/CMakeLists.txt`:
```cmake
add_subdirectory(${CMAKE_SOURCE_DIR}/../../../../../engine engine)
target_link_libraries(picklejudge pbj_engine ${OpenCV_LIBS} ...)
target_sources(picklejudge PRIVATE
    ${CMAKE_SOURCE_DIR}/../../../../../cpp/PBJEngineJSI.cpp
    ${CMAKE_SOURCE_DIR}/../../../../../cpp/BallDetectorV2.cpp)
```

iOS — add `engine/src/*.cpp`, `cpp/PBJEngineJSI.cpp`, `cpp/BallDetectorV2.cpp`
to the target; add `engine/include` to Header Search Paths; set C++ Language
Dialect to `c++17`. Call `pbj::installJSI(runtime)` from the same hook that
installs the VisionCamera frame processor plugin.
