# Reproduce overwrites document.json/output.docx in place

The admin "reproduce" actions rebuild `document.json` and/or `output.docx` from the permanently-stored Mistral response, and always overwrite the existing files at their fixed R2 keys rather than writing new versioned keys (`document.v2.json`, etc.).

We chose this over keeping every version because the goal is "old jobs should benefit retroactively from processing fixes," not "keep a diffable history of every processing run." Since the Mistral response is retained forever, no reproduce action is actually destructive — running reproduce again at any point regenerates the same output the current code would produce, so there's nothing to lose by discarding the intermediate version.

This is hard to reverse in one direction only: jobs reproduced under this policy have no historical document.json/docx to recover if we later decide versioning matters. If that need arises, we'd start versioning from that point forward rather than trying to reconstruct history for already-overwritten jobs.
