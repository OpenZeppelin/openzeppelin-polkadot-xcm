# Contributing to Polkadot OIF Escrow Settler

We really appreciate and value contributions to Polkadot OIF Escrow Settler.
Please take a moment to review the items listed below to make sure that your
contributions are merged as soon as possible.

For ANY of the items below, if they seem too complicated or hard, you can always
ask for help. We love that you are helping us, and we would love to help
you back!

## Contribution guidelines

Before starting development, please create an issue to open the discussion, validate that the PR is wanted, and coordinate overall implementation details.

## Creating Pull Requests (PRs)

As a contributor, you are expected to fork this repository, work on your own fork and then submit pull requests. The pull requests will be reviewed and eventually merged into the main repo. See ["Fork-a-Repo"](https://help.github.com/articles/fork-a-repo/) for how this works.

## Code Quality Standards

Your contribution must meet these requirements:

- **Tests**: All new features and bug fixes must be accompanied by tests.
- **Passing Tests**: All tests must pass before merging.
- **Code Style**: Follow the existing code style in the repository.
- **Documentation**: Add inline documentation for public functions and update README if necessary.

## A typical workflow

1. Make sure your fork is up to date with the main repository:

   ```sh
   # If you haven't added the upstream remote yet
   git remote add upstream <UPSTREAM_URL>
   
   git fetch upstream
   git pull --rebase upstream main
   ```

2. Branch out from `main` into a descriptive branch name (e.g. `fix/typos-in-docs` or `feat/new-settlement-logic`):

   ```sh
   git checkout -b feature/my-feature-name
   ```

3. Make your changes, add your files, update documentation, commit, and push to your fork.
   We encourage using [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for commit messages.

   ```sh
   git add .
   git commit -m "feat: add support for new asset type"
   git push origin feature/my-feature-name
   ```

4. Run tests to ensure your changes didn't break anything.

   ```bash
   # Install dependencies if you haven't already
   npm install

   # Compile contracts
   npx hardhat compile

   # Run tests
   npx hardhat test
   ```

5. Go to the repository on GitHub and issue a new pull request.
   Begin the body of the PR with "Fixes #123" or "Resolves #123" to link the PR to the issue that it is resolving.

6. Maintainers will review your code. We'll check that all tests pass, review the coding style, and check for general code correctness.

## Tests

If you are introducing a new feature, please add a new test to ensure that it works as expected. Unit tests are mandatory for each new feature.

Tests are located in the `test/` directory and use the [Hardhat](https://hardhat.org/) framework with Ethers.js.

## All set

If you have any questions, feel free to post them as an issue.

Thanks for your time and code!
