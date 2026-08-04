/**
 * Platform guide shown at /docs, structured as collapsible topic cards
 * grouped by category — not one long scroll. Each topic's `body` is a short
 * Markdown fragment shown only once its card is expanded. Editing what it
 * says never requires touching the page component, only this data.
 */
export interface DocTopic {
  id: string;
  title: string;
  /** One-line teaser shown on the collapsed card. */
  summary: string;
  /** Markdown shown once the card is expanded. */
  body: string;
}

/** A category of documentation topics shown as a collapsible group. */
export interface DocCategory {
  id: string;
  label: string;
  topics: DocTopic[];
}

/** All documentation categories and topics shown on the /docs page. */
export const DOC_CATEGORIES: DocCategory[] = [
  {
    id: "oriented",
    label: "Getting oriented",
    topics: [
      {
        id: "sidebar-map",
        title: "What's in the sidebar, and who sees it",
        summary: "A quick map of every sidebar item and which role it's for.",
        body: `
The left sidebar is the whole app. What you see there depends on your role —
nobody sees options they don't need:

| Sidebar item | Who sees it | What it's for |
|---|---|---|
| **Home** | Everyone | Chat with the tutor — the default starting point for any question |
| **Partners** | Everyone | Persistent AI companions with their own personality, connected over chat |
| **My Agents** | Admin, Instructor | Connect and consult external coding assistants (Claude Code, Codex, etc.) |
| **Co-Writer** | Everyone | A document editor for drafting notes, reports, or long write-ups with AI help |
| **Book** | Everyone | Turn source material into an interactive, chapter-based "living book" |
| **Learning Space** | Everyone | Your saved chat history, notebooks, question bank, skills, and personas |
| **Memory** | Everyone | What the tutor remembers about you, and why — fully inspectable |
| **Knowledge Center** | Admin only | Manage the document libraries that ground answers in real sources |
| **Settings** | Admin only | Model providers, network config, and other system-level configuration |
| **Browse Courses** | Everyone | See course units open for enrollment and request to join one |
| **Course Units / Admin** | Instructor, Admin | Manage the course units you teach (or, for Admins, every unit) |
| **Profile** | Everyone | Your account details |

If something you expect to see is missing, it's almost always because your
role doesn't need it — not a bug. Ask your instructor or an admin if you
think that's wrong for your situation.
`,
      },
    ],
  },
  {
    id: "students",
    label: "For Students",
    topics: [
      {
        id: "student-join-course",
        title: "Find and join a course",
        summary: "Browse Courses → Request → wait for your instructor to approve.",
        body: `
Go to **Browse Courses** in the sidebar. You'll see every course unit
currently open, with a description. Click **Request** on the one(s) you're
taking — your instructor approves the request, and the course then shows as
**Enrolled**.
`,
      },
      {
        id: "student-assignments",
        title: "Take assignments",
        summary: "Answer, submit, get graded — some instantly, some by AI shortly after.",
        body: `
Once enrolled, open your course from **Browse Courses** and go to its
**Assignments** tab. Answer each question and submit — some questions are
graded instantly (multiple choice, fill-in-the-blank), others are graded by
the AI shortly after you submit, with written feedback on what you got right
or missed. Most assignments allow a limited number of attempts, shown on the
assignment itself.
`,
      },
      {
        id: "student-notes",
        title: "Read your course notes",
        summary: "Only what your instructor has explicitly published — drafts stay private to them.",
        body: `
Your instructor may publish curated notes for the course — open the **Notes**
tab on your course page to read them. Only notes your instructor has
explicitly published are visible; drafts stay private to the instructor
until then.
`,
      },
      {
        id: "student-chat",
        title: "Use Chat (Home) to actually learn",
        summary: "The main day-to-day tool — plus Mastery Path and Quiz.",
        body: `
This is the main tool day-to-day — ask questions, work through problems, or
switch to **Mastery Path** (under *More Capabilities* in the composer) for a
structured, check-your-understanding style of learning rather than just
getting an answer handed to you. **Quiz** generates practice questions on any
topic you name.
`,
      },
      {
        id: "student-feedback",
        title: "Rate responses",
        summary: "Thumbs up/down + a private note — never shown back in your chat.",
        body: `
Click the thumbs up/down under any reply from the tutor. A small popup asks
what was good or what went wrong — that feedback goes straight to the people
maintaining this platform so they can improve it; it is never shown back in
your chat.
`,
      },
    ],
  },
  {
    id: "instructors",
    label: "For Instructors",
    topics: [
      {
        id: "instructor-units",
        title: "Your course units",
        summary: "You can teach more than one — each stays fully separate.",
        body: `
The sidebar's **Course Units** link shows every unit you're assigned to
teach. You can teach more than one unit, and each stays completely separate
from your others and from other instructors' units — you never see another
instructor's students or materials.
`,
      },
      {
        id: "instructor-roster",
        title: "Manage your roster",
        summary: "Approve/reject requests, or enroll a known student directly.",
        body: `
Open a course unit to see its enrolled students, plus a **Pending requests**
panel — approve or reject students who've requested to join. You can also
enroll a known student directly by searching their name or registration
number, without waiting for a request.
`,
      },
      {
        id: "instructor-assignments",
        title: "Build assignments",
        summary: "Add questions, set weights and attempt limits, publish to lock it in.",
        body: `
From a course unit's **Assignments** tab, create a new assignment: add
questions (multiple choice, fill-in-the-blank, short answer, or
free-response), set how much each question is worth, set an optional attempt
limit, then **Publish** it. Once published, the question set is locked —
students all see the exact same assignment. Free-response and short-answer
questions are graded automatically by the same AI used for Quiz — including
genuinely catching a student who states a wrong idea in their own words, not
just whether they picked the right multiple-choice option.
`,
      },
      {
        id: "instructor-gradebook",
        title: "Check the gradebook",
        summary: "Weighted final grade per student, one-click CSV export.",
        body: `
Each course unit has a **Gradebook** tab: every enrolled student's score on
every published assignment, combined into one weighted final grade using
each assignment's configured weight. Click **Export CSV** to download it —
opens directly in Excel or Sheets.
`,
      },
      {
        id: "instructor-notes",
        title: "Publish course notes",
        summary: "Assign one of your Books to a course unit, then publish when ready.",
        body: `
The **Notes** tab lets you assign one of your own Books to the course and
publish it — only students enrolled in *that specific course unit* can see a
published note, and drafts stay invisible until you publish.
`,
      },
      {
        id: "instructor-shared-tools",
        title: "Everything Students have, too",
        summary: "Chat, Mastery Path, Quiz, Book, Co-Writer, My Agents.",
        body: `
Instructors aren't restricted from the learning tools themselves, only from
system-level configuration (Knowledge Center, Settings) that stays
admin-only.
`,
      },
    ],
  },
  {
    id: "admins",
    label: "For Admins",
    topics: [
      {
        id: "admin-users",
        title: "User management",
        summary: "Change any account's role; see the full user list.",
        body: `
The **Admin** sidebar link lets you change any account's role (Student /
Instructor / Admin), and see the full user list (instructors only ever see
students enrolled in their own units).
`,
      },
      {
        id: "admin-units",
        title: "All course units",
        summary: "Create units, assign instructors, see across every course for oversight.",
        body: `
Unlike instructors, you see every course unit, not just ones you personally
teach — create new units, assign instructors (a unit can have more than
one), and see across every instructor's courses for oversight.
`,
      },
      {
        id: "admin-knowledge",
        title: "Knowledge Center",
        summary: "Create/delete/reindex knowledge bases, connect retrieval engines.",
        body: `
Create, delete, and reindex knowledge bases (the document libraries that
ground Chat, Book, and Co-Writer in real sources), and connect external
retrieval engines.
`,
      },
      {
        id: "admin-settings",
        title: "Settings",
        summary: "LLM provider, network, and other system-level configuration.",
        body: `
Configure the LLM provider, network settings, and other system-level
configuration. Most of this only needs touching once, at setup.
`,
      },
      {
        id: "admin-feedback",
        title: "Response Feedback review",
        summary: "Every rating, with full Q&A context — the real signal on quality.",
        body: `
\`Admin → Feedback\` shows every thumbs up/down rating left by anyone, with
the full question-and-answer pair it was rated on, an aggregate up/down
count, and a per-capability breakdown. This is the main way to tell whether
a given model or setup is actually working well in practice, not just in
theory.
`,
      },
    ],
  },
  {
    id: "tools",
    label: "The learning tools, briefly",
    topics: [
      {
        id: "tool-chat",
        title: "Chat",
        summary: "The default mode — ask anything, with tools and sources on tap.",
        body: `
The default mode. Ask anything; it can search your course's knowledge base,
read files you attach, and reason through multi-step problems.
`,
      },
      {
        id: "tool-mastery",
        title: "Mastery Path",
        summary: "Prove you understand it before moving on, rather than a straight Q&A.",
        body: `
A structured, "prove you understand it before moving on" learning flow,
rather than a straight Q&A.
`,
      },
      {
        id: "tool-quiz",
        title: "Quiz",
        summary: "Practice questions on demand — not the same as a graded Assignment.",
        body: `
Generates practice questions on any topic on demand, with instant AI-graded
feedback. (Not the same as an official Assignment — Quiz is for practice and
doesn't get recorded to a grade.) Assignments, built by your instructor, are
the graded, official version.
`,
      },
      {
        id: "tool-solve-research-visualize",
        title: "Solve / Research / Visualize",
        summary: "Worked reasoning, cited reports, and charts/diagrams — from the same composer.",
        body: `
Worked step-by-step reasoning, cited research reports, and
charts/diagrams/animations, respectively — all reachable from the same Chat
composer under *More Capabilities*.
`,
      },
      {
        id: "tool-book",
        title: "Book",
        summary: "Turns source material into an interactive, chapter-based reading experience.",
        body: `
Turns source material (a knowledge base, your notes, or chat history) into
an interactive, chapter-based reading experience with quizzes, flash cards,
and diagrams built in.
`,
      },
      {
        id: "tool-cowriter",
        title: "Co-Writer",
        summary: "A document editor with AI-assisted rewriting of any selected passage.",
        body: `
A document editor for drafting anything long-form, with AI-assisted
rewriting of any selected passage.
`,
      },
    ],
  },
  {
    id: "help",
    label: "Getting help",
    topics: [
      {
        id: "help-report",
        title: "Something looks broken or behaves unexpectedly",
        summary: "Refresh first, rate a bad response, or contact your instructor/admin.",
        body: `
1. First, try refreshing — most session hiccups resolve with a reload.
2. If a specific response was wrong or unhelpful, rate it with the
   thumbs-down button and describe what went wrong in the popup — this
   reaches the people maintaining the platform directly.
3. For anything else (can't log in, a course/assignment looks wrong, access
   you think you should have but don't), contact your instructor or the
   platform admin directly.
`,
      },
    ],
  },
];
