# paramarsm_lab_vch

Our entry for Vibe Coders Hackathon Edition 3 (21 Nov 2026): an AI-assisted procurement helper for Vinayak Group.

## The problem

Vinayak procures work in 12 manual steps, from site BOQ to signed work order. Requirements arrive as messy emails, and vendors quote in different layouts. We build tooling that:

1. Reads a site requirement and turns it into a clean BOQ
2. Matches items to ERP item codes
3. Drafts the RFQ to vendors with Vinayak's standard terms
4. Extracts and normalises vendor quotations
5. Builds a comparative statement
6. Leaves the final decision to a human

## Repo layout

```
vinayak-vch3-data/
  01_process/            12-step procurement SOP
  02_site_requirements/  Sample requirements (waterproofing, road work)
  03_tender/             Blank-rate BOQ and sample RFQ email
  04_item_codes/         ERP item codes
  05_vendors/            Contractor list
  06_quotations/         Four vendor quotations
```

## Data notice

The data pack belongs to Vinayak Group and was shared for the hackathon only. Do not redistribute it, and remove it after the event.
