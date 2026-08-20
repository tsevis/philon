# Security policy

Philon processes documents locally. Please do not file public issues containing private documents, extracted text, or exploit samples.

Report a potential vulnerability privately to the project owner with a minimal reproduction, affected version, and expected impact. The project will acknowledge reports, reproduce them in isolation, and publish a fix note after a release is available.

Current defensive boundaries: a `0600` Unix socket plus a per-session 256-bit token, no cloud transport, 500 MB input cap, 2,000-page PDF cap, invalid-signature rejection, and encrypted-PDF rejection.
