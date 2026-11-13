# Beta 4 saved file references (#335)

On 2026-11-13, the user tested the macOS development App. Finder-to-Inbox
worked, but dragging a project file or a saved pending document out of the
sidebar failed. An isolated AppKit pasteboard probe reproduced the underlying
failure: `NSPasteboardItem` rejected `NSFilenamesPboardType` as an invalid UTI.
The original Finder file URL writer was restored; pending-document drags use
the same AppKit compatibility bridge with an opaque URL that cannot resolve to
a file. The native regression exercises both payloads through a unique pasteboard.

The user then confirmed all three real gestures passed on the fixed integration
branch: project file to assistant, project file to Finder, and saved pending
text to assistant. This did not cover image/audio references or audio hardware.

The follow-up moved selected references and the skill tag above the message
field, matching the approved prototype. It removed the file count and sync icon
above Creation resources. A drag routing regression verifies a misplaced
project file no longer opens as a project or enters the Inbox, while the normal
Finder-to-project and Finder-to-Inbox flows remain available.
