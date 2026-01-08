# Automatic npm Publishing Workflow

This guide explains how to automatically publish `@presidio-dev/agent-memory` to npm whenever changes are merged to the main branch.

## Setup Instructions

### 1. Create npm Access Token

1. Log in to [npmjs.com](https://www.npmjs.com)
2. Click on your profile icon → **Access Tokens**
3. Click **Generate New Token** → **Classic Token**
4. Select **Automation** type (recommended for CI/CD)
5. Copy the token (starts with `npm_...`)

### 2. Add Token to GitHub Secrets

1. Go to your GitHub repository: https://github.com/kishan0725/OpenMemory
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `NPM_TOKEN`
5. Value: Paste your npm token
6. Click **Add secret**

### 3. How the Workflow Works

The workflow (`.github/workflows/publish-npm.yml`) automatically:

1. **Triggers** when code is pushed to `main` branch
2. **Filters** to only run when files in `packages/openmemory-js/` change
3. **Checks** if the current version already exists on npm
4. **Publishes** only if it's a new version
5. **Skips** if the version already exists (prevents errors)

## Versioning Workflow

### Before Merging to Main

**Always bump the version in `package.json` before merging to main:**

```bash
cd packages/openmemory-js

# For bug fixes (1.0.0 → 1.0.1)
npm version patch

# For new features (1.0.0 → 1.1.0)
npm version minor

# For breaking changes (1.0.0 → 2.0.0)
npm version major
```

This creates a git commit with the version bump. Then:

```bash
git push origin your-branch
```

Merge your PR to main, and the workflow will automatically publish.

### Alternative: Manual Version Bump

Edit `packages/openmemory-js/package.json`:

```json
{
  "name": "@presidio-dev/agent-memory",
  "version": "1.0.1",  // ← Change this
  ...
}
```

Commit and push:

```bash
git add packages/openmemory-js/package.json
git commit -m "chore: bump version to 1.0.1"
git push origin your-branch
```

## Workflow Behavior

### ✅ Will Publish

- Version in `package.json` is `1.0.1`
- Latest version on npm is `1.0.0`
- Result: Publishes `1.0.1` to npm

### ⚠️ Will Skip

- Version in `package.json` is `1.0.0`
- Version `1.0.0` already exists on npm
- Result: Skips publishing, shows warning in logs

### 🔍 Monitoring

Check workflow status:
1. Go to **Actions** tab in GitHub
2. Click on the "Publish to npm" workflow
3. View logs to see if publish succeeded or was skipped

## Best Practices

### 1. Version Bumping Strategy

```
1.0.0 → 1.0.1  (patch)   - Bug fixes, no new features
1.0.1 → 1.1.0  (minor)   - New features, backward compatible
1.1.0 → 2.0.0  (major)   - Breaking changes
```

### 2. Changelog

Update `CHANGELOG.md` when bumping versions:

```markdown
## [1.1.0] - 2026-01-08

### Added
- New feature X
- Enhancement Y

### Fixed
- Bug fix Z

### Changed
- Updated dependency A
```

### 3. Release Process

**Recommended workflow:**

1. **Create feature branch**
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make changes and commit**
   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

3. **Bump version before merging**
   ```bash
   cd packages/openmemory-js
   npm version minor -m "chore: bump version to %s"
   ```

4. **Push and create PR**
   ```bash
   git push origin feature/my-feature
   ```

5. **Merge to main** → Automatic publish!

### 4. Emergency Rollback

If you need to unpublish a version:

```bash
# Unpublish specific version (within 72 hours)
npm unpublish @presidio-dev/agent-memory@1.0.1

# Deprecate a version (recommended)
npm deprecate @presidio-dev/agent-memory@1.0.1 "Use version 1.0.2 instead"
```

## Troubleshooting

### Workflow Fails with "Version already exists"

This is expected behavior - the version needs to be bumped. Update `package.json` and push again.

### Workflow Fails with "Authentication failed"

1. Check that `NPM_TOKEN` secret is set correctly in GitHub
2. Verify the token is still valid on npmjs.com
3. Ensure token type is "Automation" or "Publish"

### Package Not Showing Up on npm

1. Check workflow logs in GitHub Actions
2. Verify version was actually published: `npm view @presidio-dev/agent-memory versions`
3. Sometimes npm registry takes a minute to update

### Want to Publish Manually Instead

```bash
cd packages/openmemory-js
npm publish --access public
```

## Advanced: Pre-release Versions

For beta/alpha releases:

```bash
# Create pre-release version
npm version prerelease --preid=beta
# Results in: 1.0.1-beta.0

# Or manually:
# "version": "1.1.0-beta.1"
```

Pre-release versions won't be installed by default with `npm install @presidio-dev/agent-memory` unless specifically requested:

```bash
npm install @presidio-dev/agent-memory@1.1.0-beta.1
```

## Syncing with Upstream

When merging upstream OpenMemory changes:

1. Update NOTICE file with new upstream version
2. Update package.json description with new base version
3. Bump your version number
4. Update CHANGELOG.md noting the upstream sync

Example:
```json
{
  "description": "Long-term memory engine for AI agents - Presidio fork of OpenMemory with additional features (based on OpenMemory v1.4.0)"
}
```

## Questions?

For issues with the publishing workflow, check:
- GitHub Actions logs
- npm package page: https://www.npmjs.com/package/@presidio-dev/agent-memory
- npm audit log: https://www.npmjs.com/settings/presidio-dev/packages
