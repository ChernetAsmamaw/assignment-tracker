# How Pace writes class notes

Gemini follows this guide whenever Pace turns a class transcript into notes. Edit it to change how your notes come out: the next notes Pace writes, or **Rewrite class notes** in a note's ⋯ menu, use the new version.

Whatever this guide says, Pace makes Gemini use only the transcript and cite the transcript lines behind every note, and it drops any note it can't trace back. That's what lets you hover a note to see, or hear, where it came from.

## Who the notes are for

A university student studying for a test, maybe weeks after the class, who won't rewatch it. In a few minutes of reading they should understand the class, not just recognize it.

## What to leave out

- Greetings, mic checks, jokes, tangents and classroom logistics. The exception is deadlines, readings and test details: those go in **actions**.
- Repetition. When the lecturer explains something twice, keep the clearer version.
- Anything you're not sure was said. Where the transcript is garbled, keep only what the context makes certain.

## How the notes read

- **Organize by idea, not by time.** Everything about one topic goes under one heading, even when the lecturer comes back to it later.
- **Headings name the idea**: "Chaining", "The load factor α = n/m", "Why doubling keeps inserts O(1)". Never "Introduction", "Part 2", "Continued", "Recap", "Other" or a time.
- **One idea per bullet**, short (usually under 25 words) but complete. A bullet should make sense on its own: "Collisions can't be avoided once there are more keys than buckets", not "collisions".
- **Bold the key term** at the start of a bullet that introduces or defines one: "**Open addressing** stores every key in the array itself and probes for a free slot."
- **Sub-bullets** hold what belongs under a point: the steps of a method, cases, conditions, an example and what it shows, a caveat. One level deep at most.
- **Exact details.** Keep formulas, code, numbers, units, names and dates exactly as said. Put formulas and code in backticks: `h(k) = k mod m`.
- **Keep the why.** When the lecturer gives a reason, an intuition, a trade-off, a comparison or a common mistake, keep it. That's what turns a list of facts into understanding.
- **Keep the examples**, and say what each one shows.
- **Flag test material.** Set `exam` on a line when the lecturer says it will be on a test or quiz, or stresses it ("make sure you know this", "this is important", "people always get this wrong"). Nothing else gets the flag.
- **Write plainly**, in the present tense, as facts: "Chaining keeps a list in each bucket", not "The professor explained that chaining keeps…". No "in this lecture", "we" or "you will learn".

## The parts of the notes

- **title**: what the class was about in 2 to 6 words, like a textbook section: "Hash tables and collision handling". No course code, date, "Lecture" or "Notes".
- **summary** (shown as "In short"): 2 or 3 sentences on what the class covered and the one thing to leave with.
- **takeaways**: the 3 to 6 most important ideas, one sentence each, worth memorizing. Prefer conclusions and relationships ("Keeping α bounded keeps every operation O(1) on average") over topic names. The only place a point may repeat one from the sections.
- **sections**: the content, one section per idea, in the order the class built them up, usually 3 to 8 bullets each.
- **terms**: terms the lecturer defined or clearly explained, each with a one-line definition in their words. Skip everyday words.
- **actions**: deadlines, readings, assignments and test details the student was told about, with exact dates and times. Empty if there were none.
- **questions**: 3 to 5 questions to test yourself with after class, each with a short answer from these notes. Ask about understanding (why, how, what happens if, compare) more than definitions.
