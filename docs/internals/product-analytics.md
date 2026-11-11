# Product analytics

The fork disables upstream product analytics and relay diagnostics in code. This
is a fork policy, not a runtime preference: environment flags, managed policy,
and ingest credentials must not restore reporting when merging upstream changes.

Authentication, notification publishing, and user-configured diagnostic exports
have separate purposes and remain available. See [Privacy and diagnostics](../user/telemetry.md).
