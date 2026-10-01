# ManageBac Reimagined — Apple

A userscript that restyles ManageBac after apple.com and reshapes it around
what a student actually uses each day: tasks, classes, and today's timetable.

Built on [ManageBac Reimagined](https://github.com/Arstoienn/ManageBac-Reimagined)
by Arstoien.

## What it does

- **Apple design** — SF Pro type, the `#F5F5F7` page grey with white cards,
  Apple blue for anything you can press or have selected, pill buttons and
  segmented controls, a frosted top bar, frosted menus.
- **Three tabs instead of the sidebar** — Tasks, Classes and IB Manager in the
  top bar; everything else behind `···`.
- **Class palette** — `⌘K` / `Ctrl+K` or the Classes tab: type to filter,
  arrow keys to move, Enter to open. Last year's classes fold away on their
  own, and long names are tidied (`IB DP Mathematics: Applications and
  Interpretation HL (Grade 11)` → `Math AI HL`).
- **Tasks expand in place** — click a task to read it under its row; option-click
  opens the full page. Upcoming / Past / Overdue swap without a page load.
- **Today** — a dock with the day's timetable: the two-week cycle, every gap
  shown as a break or IB Core, clubs and revision sessions, the current block
  filling as it runs, live countdowns, and the list opening on what's on now.
  It slides in and out with the page, and works in Study Mode too.
- **The aquarium** — the top of the dock is a little tank: the date and time,
  and water that rises through the day (empty at midnight, half full at noon)
  with the words turning white where the water covers them. A big swell rolls
  through on every minute and a small one on every half minute. A pixel-art
  diver lives in it and keeps himself busy — walking, jogging, a hot drink, a
  book, a laptop, a nap, jumping jacks on the sand in the morning; swimming,
  floating asleep, a treasure chest, somersaults, photos and reading once it's
  deep enough. Bubbles come only from him.
- **Due today** — on the calendar, the header card lists what's due today
  (time, task, class, type), from ManageBac's own calendar feed. The "Add
  Personal Event" and "Subscribe to Calendar" buttons are removed.

## Install

**Safari (free)** — install [Userscripts](https://apps.apple.com/app/userscripts/id1463298887)
from the Mac App Store, turn it on in Safari → Settings → Extensions, and
allow it on `managebac.com`. Then either drop
`ManageBac-Reimagined-Apple.user.js` into its scripts folder, or open the
install link below.

**Chrome, Edge, Firefox** — install [Tampermonkey](https://www.tampermonkey.net/),
then open the install link and press Install.

Install link:
https://raw.githubusercontent.com/Tiger0821/ManageBac-Reimagined-Apple/main/ManageBac-Reimagined-Apple.user.js

## Make the timetable yours

The timetable is set up for one student in class 11B at Taipei Kuei Shan
School, semester 1 of 2026–27. Everything else works for anyone on ManageBac;
for the dock, edit these near the middle of the file:

| | |
|---|---|
| `TT_RAW` | every 11B block, read from the school's Prime Timetable JSON (`/api/v2/timetables/<id>/`); the comment above it says how |
| `TT_SOURCE` | the Prime Timetable link shown at the foot of the dock |
| `TT_ANCHOR` | the Monday of any Week 2, which pins the two-week cycle |
| `TT_MINE` | the subjects you take |
| `TT_SKIP` | blocks you don't attend, as `[subject, day]` |
| `TT_CLUBS` | which service and academic club is yours, with teacher and room |
| `CONFIG.shortNames` | your own short names for classes |

## Notes

- Light mode only.
- It only ever talks to ManageBac itself (your own pages and its calendar feed).
- With "Reduce motion" turned on, the water holds still and the diver stays put.
