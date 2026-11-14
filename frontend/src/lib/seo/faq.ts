/** Shared FAQ and definition copy for /about and its JSON-LD. */

export const ABOUT_FAQ = [
  {
    question: "Is StrikeHike investment advice?",
    answer:
      "No. StrikeHike is descriptive historical research. It is not investment advice and not a forecast.",
  },
  {
    question: "What is the Core Index?",
    answer:
      "A weekly reading of US market trend and stress, set at each Friday close, on a -50 to +50 scale. Its inputs are the S&P 500's trend and volatility, with credit spreads, unemployment and the yield curve as stress inputs, each used only from the date it was published.",
  },
  {
    question: "What is sky activity?",
    answer:
      "A 0-100 rank of the day's planetary geometry against the dates in StrikeHike's own historical catalogue. 50 means busier than half of them, 99 busier than almost all. It describes the sky, not markets.",
  },
  {
    question: "What does a geometry match mean?",
    answer:
      "It is the similarity of planetary positions between two dates, on a 0-100 scale. It is a description of the sky, not a prediction.",
  },
  {
    question: "How are roundups approved?",
    answer:
      "A draft is reviewed, then the owner marks it approved. The approval helper appends a ledger line with the roundup's SHA-256 and the previous line's hash.",
  },
  {
    question: "What does the ledger prove?",
    answer:
      "It makes a silent edit detectable. Each line carries the hash of the LF-normalised roundup bytes and the hash of the line before it. It records what was published, not performance.",
  },
] as const;

export const ABOUT_TERMS = [
  {
    name: "Core Index",
    description:
      "A weekly reading of US market trend and stress, set at each Friday close, on a -50 to +50 scale.",
  },
  {
    name: "Trend warning",
    description:
      "On when the S&P 500's Friday close is below the average of its last 40 Friday closes. It is shown beside the Core Index and does not change it.",
  },
  {
    name: "Sky activity",
    description:
      "A 0-100 rank of the day's planetary geometry against StrikeHike's historical catalogue; 50 is busier than half, 99 busier than almost all.",
  },
  {
    name: "Geometry match",
    description:
      "The similarity of planetary positions between two dates, on a 0-100 scale. It describes the sky, not markets.",
  },
] as const;
