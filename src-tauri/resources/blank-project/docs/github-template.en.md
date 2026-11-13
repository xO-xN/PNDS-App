# Start a PNDS Blank project on GitHub

[简体中文](./github-template.zh-CN.md)

## Create your repository

1. On the GitHub template page, choose **Use this template → Create a new repository**. Select the owner, repository name and visibility. Leave **Include all branches** unchecked to start from the template's default branch. [GitHub template instructions](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-repository-from-a-template)
2. Clone your new repository with `git clone` and open a terminal at its root, or choose **Code → Codespaces → Create codespace** on your new repository and use its terminal.
3. Use Node.js 24 with npm. Check with `node --version`. If you have `nvm`, `nvm install 24` selects that major version. [Node.js downloads](https://nodejs.org/en/download)

## Initialize Blank

Run this from the repository root with your own values. The name is required. The author and description are optional.

```sh
npm run init:pnds -- --name 'Tidal Lines' --author 'Lin' --description 'A score for two performers'
```

Initialization writes an independent project ID and the supplied project details. `docs/template-source.json` records the Blank version used to generate the project. Running the command again keeps the existing identity and files. Edit the project in your preferred tools. [Blank implementation guide](./implementation.md)

If initialization was interrupted and `.pnds-init/` remains, confirm the command has stopped. If `manifest.json` still shows `pnds-blank-template`, save any edits made since the interruption and restore the original files with `cp -R .pnds-init/backup/. .` if the backup directory exists. Move `.pnds-init/` out of the checkout and run initialization again. If the manifest already shows your project ID, you can move the temporary directory away and continue editing.

Review, commit and push the initialization with your usual Git workflow. Include the npm lockfile if you have already installed the dependencies.

```sh
git status --short
git add -A
git diff --cached
git commit -m 'Initialize PNDS Blank project'
git push
```

## Preview without audio

```sh
npm install
npm start -- --audio-mode none
```

- Performer on [http://localhost:6868/](http://localhost:6868/)
- Monitor on [http://localhost:6869/](http://localhost:6869/)

In Codespaces, forward `6868` and `6869` from the **Ports** panel, then open each port's forwarded address. Private forwarding is sufficient for your own preview. [Codespaces port forwarding](https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace)

Press Ctrl+C in the terminal to stop the preview. Run the project with PNDS App to use its Host environment for Internal audio.

## Continue in PNDS App

- To use an existing local checkout on your Mac, choose **Open folder project** in Creation and select the folder containing `manifest.json`.
- To work from GitHub, open the Creation project picker and choose **Clone from GitHub…**. Select an authorized repository or look up a public repository by `owner/repository`. Pick the branch with your initialization commit, choose a destination and click **Clone and open**. For a private repository, sign in to GitHub in PNDS App and grant the PNDS GitHub App access first.

Both paths use the initialized project with its existing project ID and Git history.

## Share in the public project directory

If your repository is public and you want to list it, open the gear next to **About** on its GitHub page, add `pnds-project` under **Topics**, and save. This also works for existing public PNDS projects. [Public PNDS projects](https://github.com/search?q=topic%3Apnds-project+is%3Apublic&type=repositories) · [Adding GitHub topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)
