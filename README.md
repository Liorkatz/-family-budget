# Family Budget 2.0

Family budget dashboard optimized for iPhone and GitHub Pages.

## Architecture

- GitHub Pages: frontend hosting
- Supabase: Postgres, Auth, RLS, family membership, shortcut tokens and Edge Functions
- Family financial data: stored in Supabase and shared across authorized family members
- Apple Shortcuts: Apple Pay transactions are sent to the `apple-pay` Edge Function using a personal shortcut token
- The app reads and writes the shared family data directly from Supabase

No production secrets belong in this repository.
