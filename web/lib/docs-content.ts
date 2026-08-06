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
  /** One-line description shown on the category's card in the overview grid. */
  description: string;
  /** lucide-react icon name, resolved to a component where it's rendered. */
  icon: string;
  topics: DocTopic[];
}

/** All documentation categories and topics shown on the /docs page. */
export const DOC_CATEGORIES: DocCategory[] = [
  {
    id: "oriented",
    label: "Getting oriented",
    description: "A map of the sidebar and who sees what.",
    icon: "Compass",
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
| [Home](/home) | Everyone | Chat with the tutor — the default starting point for any question |
| [Partners](/partners) | Admin only | Persistent AI companions with their own personality, connected over chat |
| [My Agents](/agents) | Admin only | Connect and consult external coding assistants (Claude Code, Codex, etc.) |
| [Co-Writer](/co-writer) | Everyone | A document editor for drafting notes, reports, or long write-ups with AI help |
| [Book](/book) | Admin, Instructor | Turn source material into an interactive, chapter-based "living book" |
| [Learning Space](/space) | Admin, Instructor | Your saved chat history, notebooks, question bank, skills, and personas |
| [Memory](/memory) | Admin only | What the tutor remembers about you, and why — fully inspectable |
| [Knowledge Center](/knowledge) | Admin only | Manage the document libraries that ground answers in real sources |
| [Settings](/settings) | Admin only | Model providers, network config, and other system-level configuration |
| [Browse Courses](/courses) | Everyone | See course units open for enrollment and request to join one |
| [Course Units / Admin](/admin/course-units) | Instructor, Admin | Manage the course units you teach (or, for Admins, every unit) |
| [Profile](/profile) | Everyone | Your account details |

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
    description: "Join a course, take assignments, and use Chat to actually learn.",
    icon: "GraduationCap",
    topics: [
      {
        id: "student-join-course",
        title: "Find and join a course",
        summary: "Browse Courses → Request → wait for your instructor to approve.",
        body: `
Go to [Browse Courses](/courses) in the sidebar. You'll see every course
unit that's currently open for enrollment, each with a short description of
what it covers. Click **Request** on the one(s) you're taking this term.

That click doesn't enroll you immediately — it sends a request to the
instructor teaching that course, who has to approve it first (this stops
random people from joining a class they're not actually in). Once approved,
the course moves from "Requested" to **Enrolled** on your Browse Courses
page, and you'll now see its Assignments and Notes tabs. If a request sits
pending for a while, that's on the instructor's side — message them directly
rather than re-requesting.
`,
      },
      {
        id: "student-assignments",
        title: "Take assignments",
        summary: "Answer, submit, get graded — some instantly, some by AI shortly after.",
        body: `
Once you're enrolled, open the course from [Browse Courses](/courses) and go
to its **Assignments** tab. You'll see every assignment your instructor has
published, each with a due date if one's set.

Open an assignment and answer its questions, then submit. What happens next
depends on the question type:

- **Multiple choice and fill-in-the-blank** are graded the instant you
  submit — there's a fixed correct answer, so the system checks it right
  away.
- **Short answer and free-response** questions (where you write your own
  explanation in full sentences) are graded by AI shortly after you submit.
  It doesn't just look for the "right words" — it reads your actual
  reasoning and can tell if you got the idea right even if you phrased it
  differently, or if you got the wording right but the underlying idea
  wrong. You'll get written feedback explaining what you got right and what
  you missed.

Most assignments cap how many times you can attempt them — that limit, if
there is one, is shown on the assignment itself before you start. Once
you've used up your attempts, the assignment locks and shows your best or
final score, depending on how your instructor set it up.
`,
      },
      {
        id: "student-notes",
        title: "Read your course notes",
        summary: "Only what your instructor has explicitly published — drafts stay private to them.",
        body: `
Some instructors put together their own written notes for a course — a
curated summary of the material, built with the [Book](/book) tool (see
*The learning tools, briefly* below). If yours has, you'll find it under the
**Notes** tab on your course page.

These aren't your personal notes — they're the instructor's, shared with the
whole class. You'll only ever see a note once the instructor has explicitly
published it; while they're still working on it, it stays invisible to
students. So if a topic you expect notes on isn't there yet, it likely just
hasn't been published — not necessarily that it doesn't exist.
`,
      },
      {
        id: "student-chat",
        title: "Use Chat (Home) to actually learn",
        summary: "The main day-to-day tool — plus Mastery Path and Quiz.",
        body: `
[Home](/home) is where you'll spend most of your time. It's a chat window — type
a question the same way you would to any AI assistant, and it answers,
citing your course material where relevant. Use it to work through a
homework problem, ask it to explain something a different way, or dig into a
topic you're stuck on.

Straight Q&A isn't always the best way to learn, though — it's easy to read
an answer and feel like you understood it without actually being able to
reproduce the reasoning yourself. For that, open the composer's **More
Capabilities** menu and switch to **Mastery Path**: instead of just handing
you an answer, it walks you through a topic step by step and checks your
understanding as you go, so you have to actually engage with the material
rather than just read past it.

If you want practice questions on a specific topic — to test yourself before
a real assignment, say — use **Quiz**, also under More Capabilities. Tell it
the topic and it generates questions on demand, with feedback right away.
`,
      },
      {
        id: "student-feedback",
        title: "Rate responses",
        summary: "Thumbs up/down + a private note — never shown back in your chat.",
        body: `
Under every reply from the tutor, there's a thumbs up and thumbs down. If a
response was especially helpful (or especially wrong, confusing, or
unhelpful), click one — a small popup lets you add a quick note on what was
good or what went wrong.

This isn't a support ticket and nothing about it re-appears in your chat —
it goes straight to whoever's maintaining the platform (usually an admin) as
a data point on how well the tutor is actually working. It's the main way
the people running this platform find out when a model or a specific kind of
question isn't being handled well, so it's worth doing even for small
annoyances, not just major problems.
`,
      },
    ],
  },
  {
    id: "instructors",
    label: "For Instructors",
    description: "Build assignments, manage your roster, and publish notes.",
    icon: "ClipboardList",
    topics: [
      {
        id: "instructor-units",
        title: "Your course units",
        summary: "You can teach more than one — each stays fully separate.",
        body: `
A "course unit" is just this platform's name for a single course you teach —
think of it the same way you'd think of a class on a timetable. The
sidebar's [Course Units](/admin/course-units) link shows every unit you're
assigned to teach.

If you teach more than one course, each one is fully siloed: its own
roster, its own assignments, its own gradebook, its own notes. A student
enrolled in one of your units has no visibility into another, and you never
see another instructor's students, assignments, or materials either — only
an Admin has that cross-course view (see *For Admins* below). If you don't
see a unit you're supposed to be teaching, that's an Admin needs to assign
you to it, not something you can set up yourself.
`,
      },
      {
        id: "instructor-roster",
        title: "Manage your roster",
        summary: "Approve/reject requests, or enroll a known student directly.",
        body: `
Open one of your [course units](/admin/course-units) to see its **roster** —
the list of students currently enrolled. Above it, a **Pending requests**
panel lists everyone who's clicked "Request" to join from their side (see
*Find and join a course* under For Students) but hasn't been approved yet. Approve the ones
who should be in your class, reject anyone who shouldn't.

You don't have to wait for a student to request access, either — if you
already know who's taking the course, you can enroll them directly by
searching their name or registration number, and they'll show up enrolled
immediately without going through the request step.
`,
      },
      {
        id: "instructor-assignments",
        title: "Build assignments",
        summary: "Add questions, set weights and attempt limits, publish to lock it in.",
        body: `
From a course unit's **Assignments** tab, click to create a new assignment.
Add questions one at a time, choosing a type for each: multiple choice,
fill-in-the-blank, short answer, or free-response (the last two let students
answer in their own words rather than pick from options).

For each question, set how much it's worth toward the assignment's total —
this is its **weight**, so a question worth 10 points counts twice as much
as one worth 5. You can also set an optional limit on how many times a
student can attempt the assignment before it locks.

While you're still working on it, the assignment is a draft only you can
see. Click **Publish** when it's ready — this locks the question set so it
can't be edited afterward, and every student then sees the exact same
version. (This is deliberate: it stops the assignment from silently
changing after some students have already started it.)

Short-answer and free-response questions don't need you to grade them by
hand — they're graded automatically by the same AI that powers Quiz. It
reads what the student actually wrote, so it can catch a student who states
a wrong idea correctly in their own words, or one who uses the right
vocabulary but clearly doesn't understand the concept — not just whether
they matched a keyword.
`,
      },
      {
        id: "instructor-gradebook",
        title: "Check the gradebook",
        summary: "Weighted final grade per student, one-click CSV export.",
        body: `
Each course unit has a **Gradebook** tab that lays out every enrolled
student against every published assignment, showing their score on each
one.

It also does the arithmetic for you: each assignment's score is combined
into one overall **weighted final grade** per student, using whatever weight
you configured for that assignment (for example, if a midterm is worth twice
as much as a homework set, it counts twice as much toward the final number
automatically — you don't have to average it by hand).

Click **Export CSV** to download the whole gradebook as a spreadsheet file —
it opens directly in Excel, Google Sheets, or any spreadsheet program,
useful if your institution needs grades submitted in a specific format
elsewhere.
`,
      },
      {
        id: "instructor-notes",
        title: "Publish course notes",
        summary: "Assign one of your Books to a course unit, then publish when ready.",
        body: `
"Notes" here means a set of written course material built with the
[Book](/book) tool (covered under *The learning tools, briefly* below) —
think of a Book as the source document, and "publishing" it to a course as
the act of making it available to that class as their official notes.

From a course unit's **Notes** tab, pick one of your own Books and assign it
to the course. While you're still editing it, it stays a private draft —
only you can see it. When you're ready for students to read it, publish it;
from that point on, students enrolled in *that specific course unit* can see
it, but no one else can — not students in your other courses, and not
students in anyone else's.
`,
      },
      {
        id: "instructor-shared-tools",
        title: "Everything Students have, too",
        summary: "Chat, Mastery Path, Quiz, Book, Co-Writer, and more.",
        body: `
Being an instructor doesn't cut you off from the learning tools themselves —
you have full access to Chat, Mastery Path, Quiz, Book, and Co-Writer, the
same as any student (see *The learning tools, briefly* below for what each
one does). Useful for preparing material, checking how a topic gets
explained before assigning it, or just using the platform the way your
students do.

What you don't have is the system-level configuration that stays
admin-only: the [Knowledge Center](/knowledge) (managing the document
libraries the whole platform draws on) and [Settings](/settings) (model
providers, network config).
Those apply platform-wide, which is why they're restricted to Admins rather
than left open per-instructor.
`,
      },
    ],
  },
  {
    id: "admins",
    label: "For Admins",
    description: "Users, course units, knowledge bases, and system settings.",
    icon: "ShieldCheck",
    topics: [
      {
        id: "admin-users",
        title: "User management",
        summary: "Change any account's role; see the full user list.",
        body: `
Every account on the platform has a **role** — Student, Instructor, or
Admin — which controls what they can see and do (this is what the sidebar
map in *Getting oriented* above is describing). The
[Admin → Users](/admin/users) sidebar link is where you view and change
that.

From here you see every user on the platform, not just people in one course
— unlike instructors, who only ever see students enrolled in the units they
personally teach. You can promote a student to instructor, hand someone
admin access, or demote an account, all from the same list. Changing
someone's role takes effect immediately — the next time they load the app,
their sidebar and permissions reflect the new role.
`,
      },
      {
        id: "admin-units",
        title: "All course units",
        summary: "Create units, assign instructors, see across every course for oversight.",
        body: `
Where an instructor's [Course Units](/admin/course-units) view only shows
the courses they personally teach, yours as an Admin shows every course
unit on the entire platform.

From here, you set up a brand-new course unit before an instructor can use
it, and assign one or more instructors to teach it — a unit can have more
than one instructor if a course is co-taught. Because you can see across
every instructor's courses, this is also where you'd go to check on overall
platform activity — how many courses are running, whether a course has any
students enrolled yet, and so on — for oversight purposes an individual
instructor doesn't need.
`,
      },
      {
        id: "admin-knowledge",
        title: "Knowledge Center",
        summary: "Create/delete/reindex knowledge bases, connect retrieval engines.",
        body: `
A **knowledge base** is a library of documents — textbook chapters, lecture
slides, PDFs, whatever source material you upload — that the AI can search
through and quote from when answering a question, rather than relying only
on what it already knows in general. This is what lets Chat, Book, and
Co-Writer ground their answers in your actual course material instead of
generic knowledge, and it's why a student asking about a specific reading
gets an answer that reflects that reading. The Knowledge Center is where you
create and manage these libraries.

**Create** a new knowledge base and upload the documents that belong to it —
you might make one per course, or one per subject, depending on how you want
material organized. **Delete** removes one you no longer need, along with
everything in it.

**Reindexing** is the maintenance step behind the scenes: when the AI
searches a knowledge base, it isn't reading every document from scratch each
time — it works off a pre-built search index, similar to the index at the
back of a textbook, built when the documents were first uploaded. If you add,
remove, or edit documents in a knowledge base afterward, that index can go
stale, so **Reindex** rebuilds it from what's currently in the library. In
short: after you change what's inside a [knowledge base](/knowledge),
reindex it so searches actually reflect the update.

You can also connect **external retrieval engines** — knowledge sources
that live outside this platform (for example, a document system your
institution already runs) — so the AI can pull from those too, instead of
everything having to be uploaded here first.
`,
      },
      {
        id: "admin-settings",
        title: "Settings",
        summary: "LLM provider, network, and other system-level configuration.",
        body: `
This is the platform's control panel for the things that affect everyone at
once, rather than one course or one user.

The main one is the **LLM provider** — LLM stands for large language model,
which is the underlying AI (like GPT, Claude, or a locally-hosted model)
that actually generates the tutor's responses. This is where you configure
which one the platform talks to, and the connection details it needs to
reach it. Beyond that, [Settings](/settings) also covers **network settings**
(how the platform connects out to that AI provider, and any related
connectivity configuration) and other system-level options that apply
platform-wide.

Most of this is a "set it up once and leave it" area — you'd typically
configure it when the platform is first deployed, and only come back if
something changes (switching AI providers, a network configuration change,
etc.), not as part of day-to-day admin work.
`,
      },
      {
        id: "admin-feedback",
        title: "Response Feedback review",
        summary: "Every rating, with full Q&A context — the real signal on quality.",
        body: `
Remember the thumbs up/down students and instructors can leave on any tutor
reply (see *Rate responses* under For Students)? [Admin →
Feedback](/admin/feedback) is where all of that lands.

For every rating anyone has left, you see the full question-and-answer pair
it was rated on — not just a number, but the actual exchange, so you can
read exactly what the AI said and judge for yourself whether the rating
makes sense. Above the individual ratings, there's an aggregate up/down
count and a breakdown by capability (Chat vs. Mastery Path vs. Quiz, for
instance), so you can see at a glance whether one particular tool is
underperforming the others.

This is the most direct signal you have for whether a given AI model or
configuration is actually working well for your users in practice — rather
than just assuming it's fine because nothing crashed. Worth checking
periodically, especially after changing the LLM provider in
[Settings](/settings).
`,
      },
    ],
  },
  {
    id: "tools",
    label: "The learning tools, briefly",
    description: "What Chat, Mastery Path, Quiz, Book, and Co-Writer each do.",
    icon: "Sparkles",
    topics: [
      {
        id: "tool-composer",
        title: "The composer toolbar, explained",
        summary: "What every mode, selector, and chip in the message box actually does — and what doesn't do anything.",
        body: `
The box you type into at the bottom of [Home](/home) — the "composer" — has
more in it than a text field. Here's what each piece actually does, and,
importantly, where combining them silently does nothing.

**The mode buttons** switch what kind of turn you're about to send:

| Mode | What it does |
|---|---|
| **Chat** | Freeform conversation — ask anything, and it can search your knowledge base, read attached files, and reason through multi-step problems on its own, on the fly. This is the default and the one to reach for when you're not sure which mode fits. |
| **Quiz** | Generates a set of practice questions on a topic you name, graded instantly. Practice only — never recorded to a grade (see *Quiz* below). |
| **Research** | Produces a longer, cited report on a topic rather than a quick reply — closer to a short paper, with sources you can check. |
| **Visualize** | Turns a concept into a chart, diagram, interactive page, or a simple animation instead of (or alongside) text. |

**More Capabilities** (a small menu, not extra buttons on the main row)
holds two more:

- **Solve** — works through a problem step by step, showing its reasoning
  as it goes, rather than jumping to a final answer.
- **Mastery Path** — a structured, "prove you understand it before moving
  on" learning flow rather than a straight Q&A (see *Mastery Path* below).

Chat, Solve, and Mastery Path all share the same underlying conversation
engine — which matters for the next part.

**The persona selector** (sometimes labeled "personalities" — e.g. "as a
peer") changes the tutor's voice and approach: a peer might explain things
more casually, a teacher persona more formally, and so on. Here's the part
that isn't obvious from the interface: **persona only has any effect in
Chat, Solve, and Mastery Path.** If you select a persona and then switch to
Quiz, Research, or Visualize, the composer still shows the persona as
active, but it's quietly ignored — those three modes build their own
prompts and never read the persona setting at all. So picking "peer" and
then generating a Quiz will not produce a quiz written in a peer's voice;
it'll be indistinguishable from having no persona selected. If you want a
persona's influence, stay in Chat, Solve, or Mastery Path.

**The knowledge base selector** controls which document library(ies) get
searched for grounding an answer in real source material (see *Knowledge
Center* under For Admins for what a knowledge base actually is). You can
select more than one at a time, and your selection stays active for the
whole conversation going forward, not just the next message — so if you
switch topics partway through a chat, remember to check whether the right
knowledge base is still selected.

**The model selector** ("Select model" in the interface) picks which
underlying AI model answers your message — different configured models or
providers may be available depending on what your admin has set up. It's
not a difficulty or "thinking harder" toggle; it's genuinely choosing a
different model to talk to, which can affect both response quality and
speed. If you don't know which to pick, the default is a safe choice —
this is really meant for admins/instructors experimenting with setups, or
troubleshooting when one model seems to be behaving oddly.
`,
      },
      {
        id: "tool-chat",
        title: "Chat",
        summary: "The default mode — ask anything, with tools and sources on tap.",
        body: `
Chat is what opens when you land on **Home**, and it's the default,
general-purpose way to use the platform — a conversation with the tutor,
the same way you'd message any AI assistant.

Type a question in plain language and it answers. Behind that simple
interface, it can do more than recall facts: it can search the knowledge
base connected to your course (see *Knowledge Center* under For Admins) and
quote from the actual source material rather than guessing, read any file
you attach directly into the conversation, and work through problems that
need several steps of reasoning rather than a single lookup — showing its
work along the way rather than just stating a final answer.

Everything else on this list — Mastery Path, Quiz, Solve, Research,
Visualize — is reachable from inside this same Chat window, usually through
the composer's *More Capabilities* menu, so you rarely need to leave it. See
*The composer toolbar, explained* below for what every button and selector
in that toolbar actually does.
`,
      },
      {
        id: "tool-mastery",
        title: "Mastery Path",
        summary: "Prove you understand it before moving on, rather than a straight Q&A.",
        body: `
Ordinary chat has a weak spot: it's easy to read a good explanation, feel
like it clicked, and still not actually be able to use the idea yourself.
Mastery Path is built to close that gap.

Instead of answering a question and stopping, it breaks a topic into a
sequence of steps and checks that you've actually understood each one
before moving to the next — asking you to explain something back, apply it
to a small problem, or answer a targeted question, rather than just
presenting information for you to read. If you get something wrong, it
addresses that specific gap before continuing rather than plowing ahead. You
find it under the Chat composer's **More Capabilities** menu — start it by
naming the topic you want to work through.

It's the closest thing on the platform to working with a patient tutor who
won't let you fake your way past a concept you haven't actually grasped.
`,
      },
      {
        id: "tool-quiz",
        title: "Quiz",
        summary: "Practice questions on demand — not the same as a graded Assignment.",
        body: `
Quiz generates practice questions on any topic you name, on the spot — a way
to test yourself before you're tested for real. Answer, and it grades you
instantly with feedback on what you got right or wrong, the same AI grading
used elsewhere on the platform.

It's important to know what Quiz is *not*: it's not an official Assignment.
Nothing you do in Quiz gets recorded anywhere or counts toward your grade —
it exists purely for practice, and you can retake it as many times as you
want on the same topic. **Assignments** (covered under For Instructors) are
the graded, official version, built and published by your instructor —
those are the ones that actually count.
`,
      },
      {
        id: "tool-solve-research-visualize",
        title: "Solve / Research / Visualize",
        summary: "Worked reasoning, cited reports, and charts/diagrams — from the same composer.",
        body: `
These three are more specialized modes, all tucked under the Chat
composer's **More Capabilities** menu, for when a plain answer isn't quite
the right shape:

- **Solve** works through a problem step by step and shows its full
  reasoning as it goes, rather than jumping straight to a final answer. Use
  it for anything where seeing *how* to get to the answer matters as much
  as the answer itself — a math derivation or a multi-step logic problem,
  for example.
- **Research** produces a longer, cited report on a topic — closer to a
  short paper than a chat reply, with sources you can check yourself. Use
  it when you need to go deeper on something than a normal chat answer
  would cover.
- **Visualize** turns a concept into a chart, diagram, or simple animation
  instead of (or alongside) text — useful when something is genuinely
  easier to understand as a picture than as a paragraph.

All three live in the same conversation as your regular chat — no separate
page to navigate to.
`,
      },
      {
        id: "tool-book",
        title: "Book",
        summary: "Turns source material into an interactive, chapter-based reading experience.",
        body: `
Book takes source material you already have — documents from a knowledge
base, your own notes, or even the history of a chat conversation — and
turns it into something more like an actual textbook chapter than a wall of
raw text: organized into chapters, broken into digestible sections, with
quizzes, flash cards, and diagrams woven in throughout rather than bolted on
at the end.

The result is interactive rather than a static document — a reader can quiz
themselves as they go, flip through flash cards to review key terms, and
see concepts illustrated with diagrams, all inside the same reading
experience.

This is the tool behind **course notes**: when an instructor builds a Book
and publishes it to a course unit, that's what shows up under a student's
**Notes** tab (see *Read your course notes* and *Publish course notes*
above). You can also just use Book on its own, outside of any course, as a
way to turn a pile of source material into something actually readable.
`,
      },
      {
        id: "tool-cowriter",
        title: "Co-Writer",
        summary: "A document editor with AI-assisted rewriting of any selected passage.",
        body: `
Co-Writer is a plain document editor, similar to any word processor, meant
for drafting anything long-form — an essay, a report, lecture notes, a
write-up of an assignment.

The difference from a normal editor is that AI help is built directly into
the writing process: select any passage of text you've written, and you can
ask the AI to rewrite it — tighten it, make it clearer, fix the tone,
expand on a point — without leaving the document or copy-pasting into a
separate chat window. It's meant for improving your own writing in place,
not for generating a document from nothing.
`,
      },
    ],
  },
  {
    id: "help",
    label: "Getting help",
    description: "What to do when something looks broken.",
    icon: "LifeBuoy",
    topics: [
      {
        id: "help-report",
        title: "Something looks broken or behaves unexpectedly",
        summary: "Refresh first, rate a bad response, or contact your instructor/admin.",
        body: `
Things occasionally go wrong — a page doesn't load right, a response seems
off, or something you expect to see isn't there. Work through these in
order:

1. **Refresh the page first.** Most one-off glitches are session hiccups —
   a stale connection, a page that loaded before something finished
   syncing — and a simple reload clears them. This fixes the majority of
   "this looks broken" moments, so it's always worth trying before
   anything else.
2. **If a specific tutor response was wrong, confusing, or unhelpful**,
   rate it with the thumbs-down button under that response and describe
   what went wrong in the popup (see *Rate responses* under For Students).
   This is the right channel specifically for AI answer quality — it
   reaches the people maintaining the platform directly, attached to the
   exact question and answer, so they can see precisely what happened.
3. **For anything else** — you can't log in, a course or assignment looks
   wrong, you think you should have access to something but don't, or a
   refresh didn't fix it — that's not something the thumbs-down button is
   meant for. Contact your instructor (for course-specific issues) or the
   platform admin (for account or access issues) directly, and describe
   what you were trying to do and what happened instead.
`,
      },
    ],
  },
];
