---
name: cleanup
description: Run static analysis tools (knip, jscpd, check:all), get intelligent recommendations for cleanup, and optionally create a task document.
user-invocable: true
allowed-tools: [Read, Write, Bash, Glob, Edit, Agent]
---

## Execution

1. Spawn the `cleanup-analyzer` agent to run analysis and investigate findings.
2. Present the agent's structured report to the user.
3. Ask the user: "Would you like me to create a GitHub issue for these cleanup items?"
4. If yes, create an issue in [xO-xN/PNDS-App](https://github.com/xO-xN/PNDS-App) with the findings organized as actionable steps (`gh issue create`).
