# #244 — Assistant project directories

Controlled replay uses the real `runAssistantRequest` entry, shared tool
validation, native-command adapter and saved workspace synchronization. An
explicit Edit request prepares `public/grid`, pauses, serializes its completed
checkpoint, continues the same task and saves `Grid.js` through
`create_project_file` before the existing check flow. It verifies actual next-turn
directory receipts and the workspace directory list. No shell or independent
filesystem channel is added.

Native temporary projects cover nested creation, safe reuse, subsequent text
saving, reopen/continuation and file-before-directory undo. Further cases reject
Discussion, same-name files, aliases, traversal, excluded paths and replaced
project identity. Directory inode replacement blocks subsequent task writes and
undo. A task-capacity failure retains only the directories actually created;
reopen validates that partial progress. Interrupted publication and removal
fixtures test recovery on both sides of their native journal boundary. Creator
additions retain their nonempty directories, while later file edits block undo.

`AssistantTasks` interaction coverage uses Tab and Enter for whole-task undo and
checks the retained-directory feedback. English and Chinese copy identify
directory creation and explain that only empty task-owned directories are
removed. Existing per-change undo remains available.

The controlled model and command boundary do not establish real model placement
quality or macOS rendering. Exercise the real App directory tree, pause/restart,
native Undo keyboard path, and directory/file adoption scenario with #172.
No dev server is started by the agent.
