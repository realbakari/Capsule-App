# iOS Simulator

The Simulator panel shows a live iOS Simulator beside a conversation, so you
can watch an app change as the agent works and try it yourself without
leaving Capsule. It needs a Mac with Xcode installed; Capsule does not install
Xcode, runtimes or devices.

## Open a simulator

Open the inspector and choose **Simulator**, or pick **Open iOS Simulator**
from the command palette. The device picker at the top lists every simulator
Xcode knows about with its runtime and whether it is running.

The phone appears straight away with an attach card on its screen. Attaching
is the moment you decide three things at once: Capsule shows the device here,
you can tap it, and this conversation's agent may see and drive it. The card
says whether the device is running or shut down, confirms Xcode and touch
input are available, and offers **Attach simulator**. The arrow beside it
attaches a different device. Attaching a shut-down device starts it; the
screen lights up once it has booted.

Each conversation attaches its own device, and the choice is remembered.
**Detach simulator** in the Tools drawer ends the agent's access and returns
to the attach card. Turn **Agent simulator access** off in Settings to keep
agents away from simulators entirely; you can still watch and tap.

The screen is a stream of still frames captured a few times a second. It is
not video: animations look stepped, and a frame can lag the device by a
fraction of a second. Pause the stream with the pause control and capture a
single frame with refresh when you want a steady picture.

The device does not need the Simulator app open. **Open in the Simulator
app** brings the real window forward when you want Apple's own controls.

## Controls

The floating toolbar under the screen offers, left to right:

- **Home**, once touch input is connected.
- **Pause / resume** the live screen, and **refresh** one frame while paused.
- **Copy a screenshot** to the clipboard as an image you can paste into a
  message or another app.
- **Record** the screen to a video in your Downloads folder; press it again
  to stop, and the file opens.
- **Device tools**, the drawer described below.
- **Open a URL**, for a web address or a deep link such as `myapp://home`.
- **Installed apps**, listing the apps you have built onto this device with
  **Launch** and **Quit**.
- **Type text** into whichever field has focus on the device, once touch
  input is connected. **Return** presses the keyboard's return key.
- **Power**: shut the device down, or start it when it is off.

## Device tools

The drawer groups everything on the device that is a setting rather than a
gesture. Each value shown is read back from the device after a change.

- **Appearance**: light or dark.
- **Text size**: step Dynamic Type up or down, and **Increase contrast**.
- **Rotation**: portrait or either landscape, once touch input is connected.
- **Status bar**: the clean 9:41 look with full signal and battery, or clear
  the override.
- **Location**: set a latitude and longitude, or clear the simulated location.
- **Push notification**: send a test notification with a title and body to one
  of your apps.
- **Permissions**: grant, revoke, or reset a permission such as location,
  photos, or microphone for one of your apps. Changing a permission may quit
  the app.
- **Agent access**: what this conversation's agent may do, and **Detach
  simulator**.

## Agents and the simulator

A direct agent in a conversation with an attached simulator gets tools to
read its status, take screenshots, tap, swipe, type, press Return or Delete,
press Home, open URLs, list your apps, and launch one. It reaches only that
device: it cannot pick, start, shut down, or configure simulators. Taps and
typing wait for touch input, which may mean a first-use build. The agent is
told that dispatching a gesture is not proof of the result and to take a
screenshot afterwards.

Detaching the device, or turning **Agent simulator access** off in Settings,
cuts a running agent off at its next call. Gateway sessions do not receive
these tools; their simulator access depends on the Gateway and agent setup.

## Touching the screen

Apple's command-line tools can show a simulator but cannot tap it, so
Capsule brings its own touch bridge: a small test runner that Xcode builds
from source the first time you watch a device, and that Capsule starts on each
simulator you open. Nothing is downloaded and nothing is installed outside
Capsule's own data folder. The first build takes a minute or two and happens
once per Xcode version; the panel says **Preparing touch input** while it
runs, then **Connecting touch input** for the few seconds it takes the runner
to start on a device. After that, click the screen to tap, drag to swipe, and
use Home and Type text. **Return** in the typing row presses the keyboard's
return key.

Gestures go through Apple's testing framework, which waits for the app to
settle before each one, so a tap lands about a second after you click. The
next frame shows the result. Dispatching a tap is not proof the app
responded; look at the screen.

If the build or the connection fails, the panel shows the reason with
**Retry**. Touch input needs the full Xcode app selected as the active
developer directory; the command-line tools alone are not enough. Shutting a
device down also stops its bridge.

## Limits

- One display per device; external displays and watch pairs are not shown.
- Hardware buttons other than Home, and installing an app from a file, are
  not offered yet. Use the Simulator app for those.
- Typing goes to whichever app has keyboard focus. If no field is focused,
  the panel says so instead of typing into the wrong place.
- The panel is desktop-only. A paired viewer cannot open or control a
  simulator.
- Agents do not receive simulator tools through this panel. They can still
  drive `simctl` from a terminal like any other command.
