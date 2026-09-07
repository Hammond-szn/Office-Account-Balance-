# Office Account Balance

This is a local multi-office account-balancing application based on the calculation in `Algor.cpp`.

## Run it

1. Install Node.js 22 or newer.
2. Open PowerShell in this folder.
3. Run `npm start`.
4. Open <http://localhost:3000>.
5. Create an account and sign in.

The SQLite database is created automatically at `data/office-balance.sqlite`. It stores users, secure sessions, offices, percentage settings, and saved calculations. The database is intentionally ignored by Git.

Each office starts with a 35% deduction setting. The percentage can be changed for an office and overridden for an individual saved calculation. Records preserve the percentage used at the time they were saved.
