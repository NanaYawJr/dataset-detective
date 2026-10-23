# Contributing

Thanks for your interest. Feedback and bug reports are the most useful contributions right now — please use the [issue templates](https://github.com/NanaYawJr/dataset-detective/issues/new/choose), and **never attach real or sensitive data**.

## Working on the code

1. Open the repo in GitHub Codespaces, or run `npm ci` locally (Node.js 22+).
2. Start the app with `npm run dev`.
3. Before opening a pull request, run:

   ```bash
   npm run check     # types, lint, formatting, unit tests
   npm run test:e2e  # browser tests against the production build
   ```

## Principles

- **Rules decide.** Every finding must come from a deterministic, tested rule that can state its evidence.
- **Nothing leaves the browser** during profiling. Don't add network calls, analytics or third-party scripts to the profiling flow.
- **Test against known answers.** New checks should be covered by the golden sample or a small purpose-made fixture with an exact expected result.
- **Plain English.** Messages should say what's wrong, where, and what to do about it.
