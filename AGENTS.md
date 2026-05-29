# Global Instructions

## English For Written Artifacts

Always write in English for anything committed, persisted, or shared, regardless of the user's chat language.
This applies to commit messages, branch names, tag names, PR/issue titles and bodies, review comments, inline remarks, code identifiers, comments, docstrings, log messages, error strings, test names, file and directory names, persisted memory, and persisted scratchpad or working notes.
Chat responses may follow the user's language. Written-and-kept artifacts must be English because collaborators and tooling such as CI, search, code review, and audit logs are English-first.

## Scope And Decisions

- Read the relevant code before editing.
- Follow existing project patterns, helpers, and conventions.
- If ambiguity affects correctness, compatibility, security, data loss, or irreversible work, ask before proceeding.
- Otherwise choose the simplest reasonable interpretation that fits the existing code.

## Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that was not requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50 without losing clarity or correctness, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## DRY And Maintainability

- Remove duplication introduced or exposed by your change.
- Refactor immediately when repeated logic or poor structure makes code harder to understand or maintain.
- Reuse existing utils or helpers first; extract focused helpers when the same logic appears more than once.
- Avoid speculative abstractions for future requirements.
