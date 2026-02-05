import { GoogleGenAI } from "@google/genai";
import type GoogleDrive from "./drive.js";

export interface QueryGeminiNotesOptions {
  /** Drive folder ID to search (if set, only this folder is used). */
  folderId?: string;
  /** Folder name to look up (e.g. "Meet Recordings"). If set with folderId missing, tries this folder first. */
  folderName?: string;
  /**
   * When not using a folder, search all Drive for docs whose title contains this string.
   * Default "Notes by Gemini" (Google Meet "Take notes for me" uses this suffix).
   */
  titlePattern?: string;
  /** Only include files modified on or after this time (RFC3339). */
  timeMin?: string;
  /** Only include files modified on or before this time (RFC3339). */
  timeMax?: string;
  /** Filter files whose name contains this string (e.g. meeting title). */
  meetingName?: string;
  /** Maximum number of note documents to load and send to Gemini (default 15). */
  maxDocs?: number;
}

const DEFAULT_FOLDER_NAME = "Meet Recordings";
const DEFAULT_TITLE_PATTERN = "Notes by Gemini";
const DEFAULT_MAX_DOCS = 15;
const GEMINI_MODEL = "gemini-2.0-flash";

function escapeDriveQuery(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Find meeting note docs in Drive (by folder or by title pattern like "Notes by Gemini"),
 * then ask the Gemini API to answer the user query over those notes.
 */
export async function queryMeetingNotes(
  drive: GoogleDrive,
  geminiApiKey: string,
  query: string,
  options: QueryGeminiNotesOptions = {}
): Promise<string> {
  const maxDocs = Math.min(options.maxDocs ?? DEFAULT_MAX_DOCS, 25);
  const titlePattern = options.titlePattern ?? DEFAULT_TITLE_PATTERN;

  let filesJson: string = "";

  if (options.folderId) {
    filesJson = await drive.listFilesInFolder(options.folderId, {
      pageSize: maxDocs,
      orderBy: "modifiedTime desc",
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      nameContains: options.meetingName,
    });
  } else if (options.folderName) {
    const folderId = await drive.getFolderIdByName(options.folderName);
    if (folderId) {
      filesJson = await drive.listFilesInFolder(folderId, {
        pageSize: maxDocs,
        orderBy: "modifiedTime desc",
        timeMin: options.timeMin,
        timeMax: options.timeMax,
        nameContains: options.meetingName,
      });
    } else {
      filesJson = "No files found.";
    }
  }

  if (!options.folderId && (!options.folderName || filesJson === "No files found.")) {
    // No folder or folder not found: search all Drive for docs whose title contains the pattern (e.g. "Notes by Gemini")
    let q = `name contains '${escapeDriveQuery(titlePattern)}' and mimeType = 'application/vnd.google-apps.document'`;
    if (options.timeMin) {
      q += ` and modifiedTime >= '${options.timeMin.replace(/'/g, "\\'")}'`;
    }
    if (options.timeMax) {
      q += ` and modifiedTime <= '${options.timeMax.replace(/'/g, "\\'")}'`;
    }
    if (options.meetingName) {
      q += ` and name contains '${escapeDriveQuery(options.meetingName)}'`;
    }
    filesJson = await drive.listFiles(q, maxDocs, "modifiedTime desc");
  }

  if (filesJson === "No files found." || filesJson === "[]") {
    return `No meeting notes found. By default we search for Google Docs whose title contains "${titlePattern}". If your notes use a different title, set titlePattern (e.g. "Notes by Gemini"). You can also set folderId or folderName to limit search to a folder.`;
  }

  let files: Array<{ id: string; name: string; modifiedTime?: string }>;
  try {
    files = JSON.parse(filesJson);
  } catch {
    return "No meeting note files found for the given criteria.";
  }

  if (!Array.isArray(files) || files.length === 0) {
    return `No meeting notes found matching "${titlePattern}" (and any date/name filters). Try widening the date range or omitting meetingName.`;
  }

  const contents: string[] = [];
  const concurrency = 3;
  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (f: any) => {
        try {
          return await drive.getFileContent(f.id);
        } catch {
          return null;
        }
      })
    );
    results.forEach((r) => {
      if (r) contents.push(r);
    });
  }

  if (contents.length === 0) {
    return "Could not read content from any of the meeting note files.";
  }

  const ai = new GoogleGenAI({ apiKey: geminiApiKey });
  const combinedNotes = contents.join("\n\n---\n\n");
  const prompt = `You are answering questions over meeting notes (transcripts and summaries from Google Meet "Take notes for me" / Gemini). Use only the content below. If the answer is not in the notes, say so. Be concise but include specific details (e.g. decisions, action items, names) when available.

MEETING NOTES:
---
${combinedNotes}
---

USER QUESTION: ${query}`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    const text = (response as { text?: string }).text;
    if (!text) {
      return "Gemini did not return a text response. Try rephrasing your question or reducing the date range.";
    }
    return text;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("API key") || message.includes("403") || message.includes("401")) {
      return "Gemini API error: Check that GEMINI_API_KEY is set and valid (get a key at https://aistudio.google.com/apikey).";
    }
    throw new Error(`Failed to query Gemini over meeting notes: ${message}`);
  }
}
