## Summary

Describe the user-visible change and why it belongs in Pulse.

## Verification

- [ ] `npm test`
- [ ] `npm run audit:history`
- [ ] UI changes: `npm run test:desktop`
- [ ] Release changes: build first, then `npm run test:release`

## Privacy

- [ ] No tokens, credentials, raw MCP responses, FIT files, coordinates, activity IDs, personal paths, real health snapshots, or identifying screenshots are included.
- [ ] New health fields preserve missing values as unavailable rather than converting them to zero.
- [ ] Training guidance is framed as reference information, not medical advice.
