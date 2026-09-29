# Family Budget 2.0

Family budget dashboard optimized for iPhone and GitHub Pages.

## Architecture

- GitHub Pages: frontend hosting
- Supabase: Auth, family membership, shortcut tokens, minimal usage telemetry
- IndexedDB on the user's device: transactions, incomes, categories, budgets, fixed expenses and locations
- Legacy Supabase financial tables: retained temporarily only for one-time migration to v2 devices
- Apple Shortcuts: current Apple Pay ingestion remains legacy until the shortcut is moved to a local-only capture flow

No production secrets belong in this repository.
