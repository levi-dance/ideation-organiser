# Banked Ideas

Features judged worth building, parked for a future session.

## Resurfacing digest

Ideas die in Notion because nothing brings them back. A weekly cron (the plumbing already exists — see `app/api/cron/`) that surfaces 3–5 old entries picked by a mix of age, category, and "never opened since filing", each with a one-line AI reminder of why the idea seemed good. Spaced repetition for thoughts. Pairs naturally with the weekly synthesis; could even be a section of it.

## "You've thought this before" backlinks

Distinct from dedup-blocking: when a new capture is semantically close to existing entries, file it anyway but attach backlinks to the related ones ("related: 3 entries") in both Notion and the entry log. Over time ideas cluster themselves, and a recurring thought is a strong signal it's worth acting on. The embeddings infrastructure from Ask-your-brain (`entry_embeddings` + `match_entries`) already does the hard part — this is a threshold query at ingest time plus a place to store the links.

## Zero-friction ingest channels

The web page is still a tab to open. Add an email-in address (inbound email webhook) and/or a Telegram bot so capture works from anywhere — forwarded emails, shared links, texts to self. URLs get special handling: fetch the page, AI-summarise it, file as a reference with the summary in the body. Capture friction is the thing that kills second brains, so every removed step compounds.
