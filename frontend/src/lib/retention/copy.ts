const NUMBER_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
] as const;

/** One complete, grammatical sentence for the change note. */
export function newDatesSentence(count: number, followed: boolean): string {
  const scope = followed ? "in your themes" : "across all themes";
  if (count === 0) return `No new dates were added ${scope}.`;
  const number = count <= 9 ? NUMBER_WORDS[count] : String(count);
  return `${number} new ${count === 1 ? "date was" : "dates were"} added ${scope}.`;
}
