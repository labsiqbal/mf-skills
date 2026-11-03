# GitHub content

Use for text people read on GitHub: repository descriptions, READMEs, issues, pull
requests, release notes, and Discussions. For agent instructions or skill behavior,
use [skill instructions](skill-instructions.md) and preserve their technical rules.

## Brief questions

Clarify the GitHub artifact, reader, purpose, project stage, language, and material
to preserve. A README should answer what the project is, who it is for, how to start,
and relevant limits. A repository description should be one scannable sentence.
An issue should separate the problem, context, reproduction steps, and expected
result. A PR should explain the change, reason, impact, and checks. Release notes
should state user-relevant changes and migration actions when needed.

## Writing

Preserve package names, commands, paths, APIs, versions, status, and code examples
exactly unless a technical change is requested. Do not turn copy into claims about
features that do not exist. Separate reader-facing text from maintainer notes or
reviewer instructions. Choose structure by artifact; do not use one template for
every GitHub page.

Use direct sentences and searchable terms. Avoid unsupported promotional jargon.
For issues and PRs, traceability matters more than distinctive voice. For READMEs
and repository descriptions, readers should quickly understand the use and next
step. Do not add badges, metrics, testimonials, or release status without source
material.

## Review

Check that links, commands, filenames, versions, and status keep their meaning.
Make sure the title and opening identify the right artifact. Issues and PRs should
stand alone without internal chat notes. Release notes must not imply changes absent
from the diff or supplied material.
