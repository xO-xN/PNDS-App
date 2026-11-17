# PNDS Creator's Guide

[Create a Blank project](#create-a-blank-project) → [Author](#2-the-authoring-and-iteration-workflow) → [Test](#3-dress-rehearsal-self-check) → [Generate a .pnds bundle](#4-packaging-and-publishing).

## Create a Blank project

Choose **Blank** from the Creation home or project picker. Enter a project name, a folder name and a parent folder. Creator, introduction and Git identity are optional. Choose an unused destination. The workspace opens after creation, ready for you to start a test. Blank starts silent.

## Start from GitHub

To work in an external editor or Codespaces, open the [official PNDS template](https://github.com/xO-xN/PNDS-Template) and choose **Use this template → Create a new repository**. Use the default branch. Follow the instructions in the new repository to initialize the project, preview it without audio, and open it in the App later.

If you already created a Blank project in the App, use the [first template backup workflow](./app-tutorial.md#verify-an-official-template-repository-for-the-first-backup).

## App local versions and history

Save, browse or switch [project versions](./app-tutorial.md#project-versions-and-history) in the workspace.

## Prerequisites

The App includes an editor, Node and local Git. [Configure a model service](./app-tutorial.md#configuring-a-model-service) to use Discussion or Work. After changing SynthDef source, [compile the artifact](./reference/supercollider.md) with SuperCollider.

## 1. Creating and initialising a Project

The project's `docs/implementation.md` describes files and work rules. `AGENTS.md` points to installed contracts. The root [README](./readme-guide.md) introduces the performance. Blank supplies the identity, input, view, recording and preview foundations.

## 2. The authoring and iteration workflow

1. Set the goal in [Discussion and Work](./app-tutorial.md#discussion-and-work), then make the changes in Work.
2. Integrate documents from [Creation resources](./app-tutorial.md#creation-resources) or adopt [modules and shared packages](./app-tutorial.md#add-modules-and-shared-packages) as needed.
3. [Save and test](./app-tutorial.md#drafts-saved-files-and-running-content), then save a project version. [Record a handoff](./app-tutorial.md#record-a-handoff-and-continue-externally) to continue externally.

### Adding an optional hub through chat

See [hub](./modules/hub.md) for integration and dependencies.

### Selecting the work's connection protocol

Ordinary touch participation uses HTTP. Set up [trusted HTTPS](./reference/https.md) when browser APIs require a secure context. See [native media](./reference/native-media.md) for native device input.

## 3. Dress rehearsal self-check

Start the saved project with [live testing](./app-tutorial.md#real-time-testing-and-performer-windows). Compile edited SynthDefs and confirm they are loaded. Check the monitor or projection, performer phone and sound as the work requires.

## 4. Packaging and publishing

Choose **Generate .pnds** in the workspace project menu, confirm the saved version and select the output. See the [bundle contract](./reference/pnds-bundle.md).

## Discuss, edit and check independently

The workspace provides [temporary preview](./app-tutorial.md#change-proposals-and-temporary-preview) and [saved-copy runtime checks](./app-tutorial.md#controlled-saved-copy-checks).

## Default performer input

Blank wires single-point mouse and multitouch input after performer admission. Use the common live and playback entry for work effects and state. See the project's `docs/implementation.md` and the [recording protocol](./reference/performance-recording.md).
