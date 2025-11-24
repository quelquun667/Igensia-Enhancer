# Changelog

## 2.2.3 - 2025-11-24
- Remove injected timer feature (moved/removed by user request).
- Update README to display manifest version.

## Unreleased
- Use this top section for ongoing work before you publish a release.

How to update the changelog quickly (PowerShell)

- Read the version from the manifest:

  $v = (Get-Content .\IgensiaExtension\manifest.json -Raw | ConvertFrom-Json).version

- Prepend or append a new entry to `CHANGELOG.md`:

  $date = (Get-Date).ToString('yyyy-MM-dd')
  $entry = "## $v - $date`n- Short note about the change`n"
  Add-Content -Path .\CHANGELOG.md -Value $entry

Alternatives

- Use GitHub Releases for a formal changelog tied to tags — create a release on GitHub and paste the notes there.
- Use a conventional `CHANGELOG.md` with Keep a Changelog style (https://keepachangelog.com/) if you want more structure.

Notes

- Keep entries brief; prefer human-readable notes rather than full commit dumps.
- Optionally add links to PRs or issue numbers for traceability.
