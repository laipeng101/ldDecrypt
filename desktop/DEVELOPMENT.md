# Desktop development

Integration branch: `desktop`
Upstream branch: `upstream/node-v1.0.x`

Never develop directly on `desktop`.

## Workflow

1. Update `desktop`
2. Create topic branch
3. Implement
4. Run local tests
5. Commit
6. Push
7. Open PR to `desktop`
8. Wait for CI
9. Squash merge
10. Delete topic branch

## Release

1. Open a version bump PR
2. Wait for CI
3. Merge the PR
4. Run the Release workflow from `desktop`
