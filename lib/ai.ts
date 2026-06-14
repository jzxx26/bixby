import { Article } from "./sources/rss";

interface ProcessedItem {
  title: string;
  summary: string;
  tldr: string;
  sentiment: string;
  category: string;
  source_url: string;
  source_name: string;
}

// Extracts all complete JSON objects from a potentially truncated array string.
function salvagePartialJsonArray(raw: string): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  const objectRegex = /\{(?:[^{}]|\{[^{}]*\})*\}/g;
  let match: RegExpExecArray | null;
  while ((match = objectRegex.exec(raw)) !== null) {
    try {
      results.push(JSON.parse(match[0]));
    } catch {
      // skip malformed object
    }
  }
  return results;
}

export async function processWithAI(
  articles: Article[]
): Promise<ProcessedItem[]> {
  if (articles.length === 0) return [];

  // Process all sampled articles (up to 90, balanced across sources)
  const articlesToProcess = articles;

  const prompt = `
You are a personal news curator for Jason, a 20-year-old CS student and mobile developer.

Jason's interests:
- Formula 1: Paddock news, driver updates, technical controversies, team politics
- Dev Tools: New CLI tools, productivity apps, VS Code extensions, mobile dev tools (Flutter/Kotlin)
- Machine Learning: New papers, tools, frameworks, practical applications
- Productivity: Personal growth tools, time management apps, note-taking systems

Filter these articles and only include items that:
1. Are genuinely interesting/useful (not clickbait)
2. Provide new information (skip rehashed news)
3. Match Jason's specific interests above

Do not classify everything as F1. Only tag articles that are exclusively about motorsport under 'f1'. Articles about tech, AI, tools, dev, productivity, or general news MUST go into their appropriate categories.

Aim for 8-12 relevant items total, ensuring at least 2 from each main category: f1, dev_tools, ml_news, productivity. If a category has fewer good matches, prioritize quality over quantity.


For each relevant item, provide:
- **Title**: Keep original or make it clearer
- **Summary**: Exactly 2-3 sentences explaining what it is and why it matters to Jason
- **TL;DR**: ONE sentence (10-15 words max) capturing the core point
- **Sentiment**: Choose ONE tag that best describes the tone/content:
  - "drama" - Controversy, gossip, conflicts, scandals
  - "technical" - Deep technical content, complex topics, dense material
  - "breaking" - Time-sensitive news, urgent updates, fresh announcements
  - "hot_take" - Opinion pieces, controversial takes, provocative content
  - "educational" - Tutorials, guides, learning resources, how-tos
  - "neutral" - Standard news, updates, general information
- **Category**: f1, dev_tools, ml_news, productivity, or misc

Articles to process:
${JSON.stringify(
  articlesToProcess.map((a) => ({
    title: a.title,
    summary: a.summary.substring(0, 200), // Truncate for token savings
    url: a.url,
    source: a.source,
  }))
)}

Return ONLY a JSON array:
[
  {
    "title": "...",
    "summary": "...",
    "tldr": "...",
    "sentiment": "...",
    "category": "...",
    "source_url": "...",
    "source_name": "..."
  }
]

Be selective but comprehensive. Prioritize quality, but ensure coverage across categories.
`;

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://jacyverse.tech", // Optional
          "X-Title": "Personal Daily Digest", // Optional
        },
        body: JSON.stringify({
          // Use a supported OpenRouter model. Changeable via env if desired.
          model: process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 4096,
        }),
      }
    );

    if (!response.ok) {
      console.error(
        `OpenRouter API error: ${response.statusText}`,
        await response.text()
      );
      console.log(
        "model used:",
        process.env.OPENROUTER_MODEL || "openai/gpt-3.5-turbo"
      );
      throw new Error(`OpenRouter API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    // Extract JSON from markdown code block if present
    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/\[\s*\{[\s\S]*\}\s*\]/);
    const jsonString = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;

    try {
      const processedItems: ProcessedItem[] = JSON.parse(jsonString);
      return processedItems;
    } catch {
      // Output was truncated — salvage complete objects from the partial JSON
      const recovered = salvagePartialJsonArray(jsonString);
      if (recovered.length > 0) {
        console.warn(`JSON truncated; recovered ${recovered.length} items.`);
        return recovered as ProcessedItem[];
      }
      throw new Error("Could not parse or recover JSON from AI response");
    }
  } catch (error) {
    console.error("AI processing failed:", error);
    return [];
  }
}

export async function processOfficialSourcesWithAI(
  articles: Article[]
): Promise<ProcessedItem[]> {
  if (articles.length === 0) return [];

  const prompt = `
You are a personal news curator for Jason.
These are OFFICIAL updates from major AI companies (Anthropic, OpenAI, Google).
Your job is NOT to filter them, but to summarize and format them for his digest.

Process EVERY single article provided below. Do not skip any.

For each item, provide:
- **Title**: Keep original or make it clearer
- **Summary**: Exactly 2-3 sentences explaining what it is and why it matters to a developer/AI researcher.
- **TL;DR**: ONE sentence (10-15 words max) capturing the core point
- **Sentiment**: Choose ONE tag that best describes the tone/content:
  - "breaking" - Major announcements, new models, big releases
  - "technical" - Deep dives, research papers, engineering blogs
  - "educational" - Guides, tutorials, best practices
  - "neutral" - General updates, policy changes
- **Category**: ALWAYS set this to "official_news"
- **Source URL**: The original URL provided
- **Source Name**: The original source name provided

Articles to process:
${JSON.stringify(
  articles.map((a) => ({
    title: a.title,
    summary: a.summary.substring(0, 500), // Allow slightly longer context for official sources
    url: a.url,
    source: a.source,
  }))
)}

Return ONLY a JSON array:
[
  {
    "title": "...",
    "summary": "...",
    "tldr": "...",
    "sentiment": "...",
    "category": "official_news",
    "source_url": "...",
    "source_name": "..."
  }
]
`;

  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://jacyverse.tech",
          "X-Title": "Personal Daily Digest",
        },
        body: JSON.stringify({
          model: process.env.OPENROUTER_MODEL || "openai/gpt-oss-120b:free",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 4096,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.statusText}`);
    }

    const data = await response.json();
    const content = data.choices[0].message.content;

    const jsonMatch =
      content.match(/```json\n([\s\S]*?)\n```/) ||
      content.match(/\[\s*\{[\s\S]*\}\s*\]/);
    const jsonString = jsonMatch ? jsonMatch[1] || jsonMatch[0] : content;

    try {
      const processedItems: ProcessedItem[] = JSON.parse(jsonString);
      return processedItems;
    } catch {
      const recovered = salvagePartialJsonArray(jsonString);
      if (recovered.length > 0) {
        console.warn(`JSON truncated; recovered ${recovered.length} official items.`);
        return recovered as ProcessedItem[];
      }
      throw new Error("Could not parse or recover JSON from AI response");
    }
  } catch (error) {
    console.error("AI processing for official sources failed:", error);
    // Fallback: map manually if AI fails
    return articles.map(a => ({
        title: a.title,
        summary: a.summary.substring(0, 200) + "...",
        tldr: "Official Update (AI Processing Failed)",
        sentiment: "neutral",
        category: "official_news",
        source_url: a.url,
        source_name: a.source
    }));
  }
}
