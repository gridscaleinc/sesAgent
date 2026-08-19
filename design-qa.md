# Agent Chat UI Design QA

final result: passed

## Comparison target

- Source visual truth: `/var/folders/mq/3d3qg1312lj5x38r9b48wjqw0000gq/T/codex-clipboard-7b689717-0c9e-45bb-8255-031dfb7bd587.png`
- Rendered implementation: `/Users/yk/project/life/ses-agent-desktop/design-qa-implementation.png`
- Full-view comparison: `/Users/yk/project/life/ses-agent-desktop/design-qa-comparison.png`
- Focused comparison: `/Users/yk/project/life/ses-agent-desktop/design-qa-comparison-focus.png`
- App under test: `/Users/yk/project/life/ses-agent-desktop/release/dev/mac-arm64/SES Agent Desktop.app`

The source is the user's pre-change screenshot and therefore represents the problems to remove, rather than a pixel-identical target. The requested visual direction was a Codex-style chat: compact chrome, document-like assistant responses, light user bubbles, and a small persistent composer.

## Capture normalization

- Source pixels: 1926 × 1846. CSS viewport and source density metadata are unavailable because it is a user-supplied raster capture.
- Implementation pixels: 1176 × 768 from the packaged Electron app through macOS Computer Use. The screenshot was retained at its captured 1:1 pixel size.
- Full-view comparison canvas: 2037 × 842. The source was proportionally normalized to 768 px high; the implementation remained 1176 × 768.
- Focused comparison canvas: 1720 × 724. The answer/composer regions were independently cropped and normalized to 650 px high so typography, Markdown treatment, chrome density, and composer proportions could be judged.
- No claim of exact pixel fidelity is made across the two captures because their original viewport, density, and surrounding app chrome differ.

## State

- Simplified Chinese application UI.
- Existing conversation selected in local encrypted history.
- Current case `支付平台改造 v1` selected.
- A user prompt and an assistant candidate summary are visible.
- The implementation is scrolled to the newest answer with the persistent composer visible.
- The saved newest answer uses GPT-5.6 Luna and Japanese body text in response to `日语呢`; this content difference is historical model output, not a UI rendering difference.

## Full-view comparison evidence

The full comparison shows that the assistant answer no longer occupies a large bordered white card with a separate left-side role column. The reading column is narrower and centered, the history panel uses quiet list rows, the header is one compact bar, and the composer no longer consumes a large fraction of the viewport. The current-case context remains visible above the conversation.

## Focused comparison evidence

The focused comparison was required because the full view was too small to verify answer typography and composer density. It confirms that:

- raw `**section title**` markers are replaced by semantic headings;
- paragraphs and list items use a readable document rhythm;
- nested list items are visually subordinate;
- the assistant identity is compact and attached to the answer rather than occupying a side column;
- the model picker remains inside the composer footer;
- the send control is a compact icon button and the input no longer resembles a large form panel.

## Findings and comparison history

### Initial findings

- [P1] Assistant responses looked like oversized business cards instead of conversation turns.
  - Evidence: the source answer is enclosed by a large bordered panel and uses a separate role-label column.
  - Fix: removed the assistant card shell, centered a 760 px reading column, and introduced a compact inline assistant identity.
- [P1] Model-authored Markdown was exposed as literal `**` markers.
  - Evidence: `**基本信息**`, `**匹配情况**`, and similar strings are visible in the source.
  - Fix: added a safe React Markdown subset for headings, emphasis, ordered/unordered lists, quotes, inline code, and fenced code without `dangerouslySetInnerHTML`.
- [P1] The composer occupied excessive vertical space and visually competed with the answer.
  - Evidence: the source composer is a large persistent form with a three-line empty text area.
  - Fix: reduced it to a two-row compact composer, moved the model selector into its footer, and replaced the labeled send button with the existing icon system's arrow button.
- [P2] Header and conversation history used too much visual weight.
  - Evidence: the source header is tall and the history treatment reads as another set of cards.
  - Fix: condensed the header to 66 px and changed history items to neutral, borderless list rows with a quiet active state.
- [P2] Existing responsive rules reintroduced horizontal padding inside the entire chat main area at 1180 px and 900 px.
  - Fix: reset the chat main area to zero padding at both breakpoints and apply padding only to the header, message scroll area, case chip, and composer.

### Post-fix evidence

- `/Users/yk/project/life/ses-agent-desktop/design-qa-comparison.png` confirms the P1 layout and density issues are removed in the packaged app.
- `/Users/yk/project/life/ses-agent-desktop/design-qa-comparison-focus.png` confirms semantic headings, document rhythm, compact role treatment, and compact composer proportions.
- No actionable P0, P1, or P2 visual issue remains in the captured state.

## Required fidelity surfaces

- Fonts and typography: kept the product's existing system-font stack; changed hierarchy, size, line height, and weight only within the agent surface. Headings, body, metadata, list items, and inline code now have distinct optical roles and no raw Markdown markers remain.
- Spacing and layout rhythm: the 760 px reading column, 26–30 px turn spacing, compact 66 px header, 28 px assistant avatar, and 18 px composer radius create a consistent chat rhythm. Persistent controls remain visible at the captured 1176 × 768 viewport.
- Colors and visual tokens: retained the product's neutral navy/blue identity while moving chat surfaces to white, soft gray, and low-contrast borders. Business status colors and the current-case chip remain semantically distinct.
- Image quality and asset fidelity: this screen has no photographic or brand-image target. All visible icons reuse the project's existing `Icon` component; no emoji, CSS drawing, placeholder image, or new raster asset was introduced.
- Copy and content: existing business and safety copy is preserved. The placeholder is shortened and describes cases, candidates, and current matching results. Historical model-generated language is intentionally left untouched.

## Interaction and regression evidence

- Focused component tests: 8 passed, covering Markdown semantics plus existing agent chat behavior.
- Full test suite: 51 files and 364 tests passed.
- TypeScript typecheck passed.
- Simplified Chinese localization gate passed with zero uncataloged Japanese renderer strings.
- Packaged macOS verification passed, including renderer readiness, Agent bridge, AI-planned Tool routing, SSE model availability, conversation persistence, and DeepSeek availability.
- The packaged app launched successfully and exposed the expected history, conversation, model selector, disabled empty-send state, and current-case context through the accessibility tree.
- Read-only visual QA did not send a new model request or modify business data.

## Follow-up polish

- [P3] On very dense saved answers, consider a user-controlled compact/comfortable text-density preference if real users request it. This is not required for the current minimal implementation.

