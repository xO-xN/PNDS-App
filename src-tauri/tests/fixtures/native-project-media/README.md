# Native project media acceptance

This is a runnable PNDS project with no npm dependencies. Open this folder through
the App's ordinary project/creation workflow and select None audio mode. The App
starts `server.mjs` using the actual runtime listener handoff. Do not start a
second server over the same project. No input starts until a person clicks its
enable button. It never records, plays back or uploads raw camera/microphone data.

The page offers current camera and microphone choices, independent enable/retry
buttons and a stop button. Camera frames feed one page-owned Worker calculating
brightness; microphone samples feed one page-owned AudioContext/Analyser chain
calculating RMS. Only derived values are published to this project's server.
The projection branch reads them without opening devices or creating analysis
Workers. The fixture tests validate HTTP and derived-value isolation; they do
not establish capture or permissions. Samples expire from the server after five
seconds without publication; the page labels them as recent observations, not
hardware/permission status. Input stop retains the page connection and publishes
null feature values. The native window's actual device/privacy indicators remain
the release evidence.

## Manual run

1. Load the project through Host performance mode. Open projection, check standby
   and README, then open its monitor. Both copies initially show inputs off;
   projection identifies itself as a consumer.
2. In the main monitor choose a current camera, click Enable/retry, and make the
   real WebKit/macOS permission choice. Confirm changing camera brightness on
   both monitor and projection. Projection must not request permission. Repeat
   for microphone RMS with an actual input signal. No sound is played locally.
3. Deny a permission, check the visible feedback, change system settings if
   required, then manually retry. Try another visible input. Record the exact
   OS/device behavior; do not infer success from the presence of an API.
4. Check monitor reveal, explicit refresh/cache busting, theme/language, zoom,
   sidebar, App dialogs, keyboard focus, fullscreen and projection standby.
   Hiding a pane/overlay must preserve the document and its enabled input.
   An explicit refresh must release old input and start the new page off.
5. Enter creation mode, start this saved project and use Add performer twice.
   Confirm different displayed page identities. Choose and manually enable
   camera/microphone independently in each real window. Select the same physical
   input in both; record either real sharing or the explicit busy/error result.
   The first window must keep its stream when the second fails.
6. Stop one page's media and confirm its project connection remains. Refresh,
   replace or close that window; confirm the other still captures. Test closing
   while permission is pending; late decisions must not restore the old page.
   Check viewport presets, orientation, zoom, controls, JavaScript dialogs and
   mouse single-touch simulation using an interaction-capable project as well.
7. Stop/restart or interrupt the local transport and check the applicable retained
   document rules. On explicit close/exit confirm the OS camera/microphone
   indicators turn off when the last owner ends. Existing Client entry,
   source/storage isolation and single active App role require regression too.

Record App build, architecture, macOS/WebKit version, project revision, each
source and identity, actual devices, choices and outcomes. The fixture's camera
brightness is image analysis, not a gesture model inference claim. Optional
model first inference, real mobile sensors/touch, signed installation and joint
#313/#314 scenarios require their own evidence.
