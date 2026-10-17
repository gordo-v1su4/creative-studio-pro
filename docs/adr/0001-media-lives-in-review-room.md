# Media lives in Review Room; this app keeps references only

Every take this app generates or imports is stored once, as a version of its shot's asset in Review Room (RustFS behind it), inside a locked folder of the series tree that this app creates and owns. This app keeps the reference and the take's details, never its own copy, beyond a disposable local cache. We chose this over keeping `data/projects/<id>/files/` as the master and pushing copies up, because two masters drift (the trailer folder that moved on 2026-10-01 broke 50 links), the M3 and the public watch pages need the same files, and Review Room already has versions, per-version metadata and the hand-off to Trailer Feed.

**Consequences**: shot codes are permanent once a take is sent, since they name the Review Room asset; renaming or moving a series folder happens only from this app; deliverables are copied into a normal folder before going to Trailer Feed, never submitted from the locked tree.
