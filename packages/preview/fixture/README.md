# Preview fixture data

`whoisaldo.json` and `assets/` are a projection of the offline public capture of
https://github.com/whoisaldo (content/site-fixture, captured 2026-11-08 UTC). `source` in the JSON
records the capture's profile and manifest SHA-256. The owner chose this profile as the first
reference; its README, identity, counts and dates appear unchanged in every theme.

`generate.mjs` rebuilds the projection from a capture directory. It keeps the header, six pins,
organizations, the full 365-day calendar (counts and levels), the profile README and the
GitHub Reskin repository view, and converts the capture's allowlisted README HTML into a node tree
so the preview never parses HTML. Achievement badges are not bundled. Images are copied as
captured; the two authored dark logo variants are used on dark themes.

Notices: the GitHub Reskin README excerpt is MIT (`LICENSE-GitHub-Reskin.txt`). The README stats
panel embeds Chakra Petch and JetBrains Mono (`OFL-Chakra-Petch.txt`, `OFL-JetBrains-Mono.txt`).
The owner's profile content and the avatars and logos keep their owners' rights and are used only
in this faithful profile context.

The diff, empty-state and 404 views use fixed fictional content defined in `../views.js`.
