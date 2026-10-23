# Bundled conversation skills

The product directly loads reviewed upstream paragraphs from pinned snapshots of
`tomwong001/qingsheng-skill` and `op7418/Humanizer-zh`. Original SKILL.md and MIT
licenses are preserved beside the manifest. This is not a newly invented
substitute for their instructions.

`scripts/build-chat-skills.mjs` verifies each snapshot hash, extracts the exact
paragraphs approved in `manifest.json`, and generates the server-only runtime
bundle. `lib/chat-skill-adapter.ts` serves that text to the existing model call.
No extra model pass, network fetch, third-party service, customer-side install,
or execution of upstream commands is introduced.

The product owns the JSON/output contract, consent and speaker/source handling.
Only conversation purpose, direct message drafting, contextual consistency,
voice matching and restrained editing are enabled. Tool setup, local files,
mandatory onboarding, fixed relationship-stage labels, invented experiences,
gendered personas, pickup routines and claims about course datasets are not
loaded. The upstream examples library is not bundled: multiple examples were
inappropriate for an ordinary, mutual conversation.

Update procedure: review a new pinned commit and its license; preserve the new
snapshot; update the manifest hash and exact paragraph prefixes; run the build
and reply route regression. Upstream changes never enter prompts automatically.
