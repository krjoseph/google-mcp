import { google } from "googleapis";
import { timeApiCall } from "./helper.js";
import type GoogleCalendar from "./calendar.js";

const CONFERENCE_RECORDS_PREFIX = "conferenceRecords/";

function normalizeConferenceRecordName(idOrName: string): string {
  return idOrName.startsWith(CONFERENCE_RECORDS_PREFIX)
    ? idOrName
    : `${CONFERENCE_RECORDS_PREFIX}${idOrName}`;
}

export default class GoogleMeet {
  private meet: ReturnType<typeof google.meet>;
  private calendar: GoogleCalendar | undefined;

  constructor(authClient: any, calendar?: GoogleCalendar) {
    this.meet = google.meet({ version: "v2", auth: authClient });
    this.calendar = calendar;
  }

  /** Fetch meeting code and URI for a space; returns null if space is missing or API fails. */
  private async getSpaceInfo(spaceName: string | null | undefined): Promise<{ meetingCode: string; meetingUri: string } | null> {
    if (!spaceName || typeof spaceName !== "string") return null;
    try {
      const res: any = await this.meet.spaces.get({ name: spaceName });
      const code = res.data?.meetingCode;
      const uri = res.data?.meetingUri;
      if (code && uri) return { meetingCode: code, meetingUri: uri };
      return null;
    } catch {
      return null;
    }
  }

  /** Resolve meeting name from Calendar event that has this Meet link in the given time range. */
  private async resolveMeetingName(
    meetingCode: string,
    startTime: string | null | undefined,
    endTime: string | null | undefined
  ): Promise<string | null> {
    if (!this.calendar || !startTime) return null;
    const timeMax =
      endTime && endTime !== "(ongoing)"
        ? endTime
        : new Date(new Date(startTime).getTime() + 2 * 60 * 60 * 1000).toISOString();
    return this.calendar.getEventSummaryForMeetInRange(
      meetingCode,
      startTime,
      timeMax
    );
  }

  /**
   * List conference records (past/ongoing meetings). By default ordered by start time descending.
   * When includeAvailability is true, each meeting includes hasTranscript and hasRecording (up to maxAvailabilityChecks meetings).
   */
  async listConferenceRecords(
    filter?: string,
    pageSize: number = 25,
    pageToken?: string,
    includeAvailability: boolean = false,
    maxAvailabilityChecks: number = 15
  ): Promise<string> {
    try {
      const response: any = await timeApiCall(
        "Meet.listConferenceRecords",
        () =>
          this.meet.conferenceRecords.list({
            filter,
            pageSize: Math.min(100, pageSize),
            pageToken,
          })
      );

      const records = response.data.conferenceRecords || [];
      if (records.length === 0) {
        return "No conference records found.";
      }

      type RecordSummary = {
        name: string;
        space?: string | null;
        startTime?: string | null;
        endTime?: string | null;
        expireTime?: string | null;
        meetingCode?: string | null;
        meetingUri?: string | null;
        meetingName?: string | null;
        hasTranscript?: boolean;
        hasRecording?: boolean;
      };

      let summary: RecordSummary[];

      const spaceInfos = await Promise.all(
        records.map((r: any) => this.getSpaceInfo(r.space))
      );
      const meetingNames = this.calendar
        ? await Promise.all(
            records.map((r: any, i: number) => {
              const info = spaceInfos[i];
              return info
                ? this.resolveMeetingName(
                    info.meetingCode,
                    r.startTime,
                    r.endTime
                  )
                : Promise.resolve(null);
            })
          )
        : records.map(() => null);

      if (includeAvailability) {
        const toCheck = records.slice(
          0,
          Math.min(maxAvailabilityChecks, records.length)
        );
        const withAvailability = await Promise.all(
          toCheck.map(async (r: any, i: number) => {
            const parent = r.name;
            let hasTranscript = false;
            let hasRecording = false;
            try {
              const [trRes, recRes]: any[] = await Promise.all([
                this.meet.conferenceRecords.transcripts.list({
                  parent,
                  pageSize: 1,
                }),
                this.meet.conferenceRecords.recordings.list({
                  parent,
                  pageSize: 1,
                }),
              ]);
              hasTranscript =
                (trRes.data.transcripts?.length ?? 0) > 0;
              hasRecording =
                (recRes.data.recordings?.length ?? 0) > 0;
            } catch {
              // leave false if API fails for this record
            }
            const info = spaceInfos[i];
            return {
              name: r.name,
              space: r.space,
              startTime: r.startTime,
              endTime: r.endTime ?? "(ongoing)",
              expireTime: r.expireTime,
              meetingCode: info?.meetingCode ?? null,
              meetingUri: info?.meetingUri ?? null,
              meetingName: meetingNames[i] ?? null,
              hasTranscript,
              hasRecording,
            };
          })
        );
        const rest = records.slice(withAvailability.length).map((r: any, j: number) => {
          const i = j + withAvailability.length;
          const info = spaceInfos[i];
          return {
            name: r.name,
            space: r.space,
            startTime: r.startTime,
            endTime: r.endTime ?? "(ongoing)",
            expireTime: r.expireTime,
            meetingCode: info?.meetingCode ?? null,
            meetingUri: info?.meetingUri ?? null,
            meetingName: meetingNames[i] ?? null,
          };
        });
        summary = [...withAvailability, ...rest];
      } else {
        summary = records.map((r: any, i: number) => {
          const info = spaceInfos[i];
          return {
            name: r.name,
            space: r.space,
            startTime: r.startTime,
            endTime: r.endTime ?? "(ongoing)",
            expireTime: r.expireTime,
            meetingCode: info?.meetingCode ?? null,
            meetingUri: info?.meetingUri ?? null,
            meetingName: meetingNames[i] ?? null,
          };
        });
      }

      let result = JSON.stringify(summary, null, 2);
      if (response.data.nextPageToken) {
        result += `\n\n(nextPageToken: ${response.data.nextPageToken})`;
      }
      if (includeAvailability && records.length > maxAvailabilityChecks) {
        result += `\n\n(hasTranscript/hasRecording shown for first ${maxAvailabilityChecks} meetings only; remaining ${records.length - maxAvailabilityChecks} not checked)`;
      }
      return result;
    } catch (error) {
      throw new Error(
        `Failed to list conference records: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get meeting details including whether transcript and/or recording are available, and links when present.
   */
  async getMeetingInfo(conferenceRecordIdOrName: string): Promise<string> {
    try {
      const name = normalizeConferenceRecordName(conferenceRecordIdOrName);

      const [recordRes, trRes, recRes]: any[] = await Promise.all([
        timeApiCall("Meet.getConferenceRecord", () =>
          this.meet.conferenceRecords.get({ name })
        ),
        this.meet.conferenceRecords.transcripts
          .list({ parent: name, pageSize: 10 })
          .catch(() => ({ data: { transcripts: [] } })),
        this.meet.conferenceRecords.recordings
          .list({ parent: name, pageSize: 10 })
          .catch(() => ({ data: { recordings: [] } })),
      ]);

      const record = recordRes.data;
      const transcripts = trRes.data?.transcripts || [];
      const recordings = recRes.data?.recordings || [];

      const firstTranscript = transcripts[0];
      const firstRecording = recordings[0];

      const spaceInfo = await this.getSpaceInfo(record.space);
      const meetingName = spaceInfo
        ? await this.resolveMeetingName(
            spaceInfo.meetingCode,
            record.startTime,
            record.endTime
          )
        : null;

      const info = {
        name: record.name,
        space: record.space,
        startTime: record.startTime,
        endTime: record.endTime,
        expireTime: record.expireTime,
        meetingCode: spaceInfo?.meetingCode ?? null,
        meetingUri: spaceInfo?.meetingUri ?? null,
        meetingName,
        hasTranscript: transcripts.length > 0,
        hasRecording: recordings.length > 0,
        transcriptCount: transcripts.length,
        recordingCount: recordings.length,
        ...(firstTranscript?.docsDestination?.exportUri && {
          transcriptDocLink: firstTranscript.docsDestination.exportUri,
        }),
        ...(firstRecording?.driveDestination?.exportUri && {
          recordingPlaybackLink: firstRecording.driveDestination.exportUri,
        }),
      };

      return JSON.stringify(info, null, 2);
    } catch (error) {
      throw new Error(
        `Failed to get meeting info: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Get a single conference record by ID or resource name.
   */
  async getConferenceRecord(idOrName: string): Promise<string> {
    try {
      const name = normalizeConferenceRecordName(idOrName);
      const response: any = await timeApiCall(
        "Meet.getConferenceRecord",
        () => this.meet.conferenceRecords.get({ name })
      );
      return JSON.stringify(response.data, null, 2);
    } catch (error) {
      throw new Error(
        `Failed to get conference record: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * List transcripts for a conference record.
   */
  async listTranscripts(
    conferenceRecordIdOrName: string,
    pageSize: number = 50,
    pageToken?: string
  ): Promise<string> {
    try {
      const parent = normalizeConferenceRecordName(conferenceRecordIdOrName);
      const response: any = await timeApiCall(
        "Meet.listTranscripts",
        () =>
          this.meet.conferenceRecords.transcripts.list({
            parent,
            pageSize: Math.min(100, pageSize),
            pageToken,
          })
      );

      const transcripts = response.data.transcripts || [];
      if (transcripts.length === 0) {
        return "No transcripts found for this conference.";
      }

      const summary = transcripts.map((t: any) => ({
        name: t.name,
        startTime: t.startTime,
        endTime: t.endTime,
        state: t.state,
        docsDestination: t.docsDestination,
      }));

      let result = JSON.stringify(summary, null, 2);
      if (response.data.nextPageToken) {
        result += `\n\n(nextPageToken: ${response.data.nextPageToken})`;
      }
      return result;
    } catch (error) {
      throw new Error(
        `Failed to list transcripts: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Fetch all transcript entries for a transcript (paginating if needed).
   */
  private async fetchAllTranscriptEntries(
    transcriptParent: string,
    pageSize: number = 100
  ): Promise<any[]> {
    const entries: any[] = [];
    let pageToken: string | undefined;

    do {
      const response: any = await this.meet.conferenceRecords.transcripts.entries.list({
        parent: transcriptParent,
        pageSize,
        pageToken,
      });
      const chunk = response.data.transcriptEntries || [];
      entries.push(...chunk);
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    return entries;
  }

  /**
   * Get full transcript for a conference record as a single readable text.
   * Fetches all transcripts and their entries, ordered by time. Suitable for LLM summarization.
   */
  async getFullTranscript(
    conferenceRecordIdOrName: string,
    options?: { includeTimestamps?: boolean; includeParticipant?: boolean }
  ): Promise<string> {
    const includeTimestamps = options?.includeTimestamps !== false;
    const includeParticipant = options?.includeParticipant !== false;

    try {
      const parent = normalizeConferenceRecordName(conferenceRecordIdOrName);

      const transcriptsResponse: any = await timeApiCall(
        "Meet.listTranscripts",
        () =>
          this.meet.conferenceRecords.transcripts.list({
            parent,
            pageSize: 100,
          })
      );

      const transcripts = transcriptsResponse.data.transcripts || [];
      if (transcripts.length === 0) {
        return "No transcripts available for this meeting.";
      }

      const allEntries: Array<{
        startTime?: string | null;
        endTime?: string | null;
        text?: string | null;
        participant?: string | null;
      }> = [];

      for (const transcript of transcripts) {
        const entries = await this.fetchAllTranscriptEntries(transcript.name!);
        allEntries.push(...entries);
      }

      allEntries.sort((a, b) => {
        const t1 = a.startTime || "";
        const t2 = b.startTime || "";
        return t1.localeCompare(t2);
      });

      const lines = allEntries.map((e) => {
        const parts: string[] = [];
        if (includeTimestamps && e.startTime) {
          parts.push(`[${e.startTime}]`);
        }
        if (includeParticipant && e.participant) {
          const participantLabel = e.participant.replace(/^.*\/participants\//, "Participant:");
          parts.push(`${participantLabel}`);
        }
        parts.push((e.text || "").trim());
        return parts.join(" ");
      });

      const header = `Transcript for conference ${parent}\n${"=".repeat(60)}\n\n`;
      return header + lines.filter((l) => l.trim()).join("\n");
    } catch (error) {
      throw new Error(
        `Failed to get transcript: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Search across meeting transcripts by keyword/phrase.
   * Optionally filter by time range. Returns matching meetings with relevant excerpts.
   */
  async searchTranscripts(
    query: string,
    options?: {
      timeMin?: string;
      timeMax?: string;
      maxMeetings?: number;
      excerptLength?: number;
    }
  ): Promise<string> {
    const maxMeetings = options?.maxMeetings ?? 20;
    const excerptLength = options?.excerptLength ?? 200;
    const q = query.trim().toLowerCase();
    if (!q) {
      return "Please provide a non-empty search query.";
    }

    try {
      let filter: string | undefined;
      if (options?.timeMin || options?.timeMax) {
        const parts: string[] = [];
        if (options.timeMin) {
          parts.push(`start_time >= "${options.timeMin}"`);
        }
        if (options.timeMax) {
          parts.push(`start_time <= "${options.timeMax}"`);
        }
        filter = parts.join(" AND ");
      }

      const listResponse: any = await timeApiCall(
        "Meet.listConferenceRecords",
        () =>
          this.meet.conferenceRecords.list({
            filter,
            pageSize: maxMeetings,
          })
      );

      const records = listResponse.data.conferenceRecords || [];
      if (records.length === 0) {
        return "No meetings found in the given range.";
      }

      const results: Array<{
        conferenceRecord: string;
        startTime?: string;
        endTime?: string;
        matches: Array<{ excerpt: string; startTime?: string }>;
      }> = [];

      for (const record of records) {
        const parent = record.name;
        let transcripts: any[];
        try {
          const trResponse: any = await this.meet.conferenceRecords.transcripts.list({
            parent,
            pageSize: 100,
          });
          transcripts = trResponse.data.transcripts || [];
        } catch {
          continue;
        }

        const matchingExcerpts: Array<{ excerpt: string; startTime?: string }> = [];

        for (const transcript of transcripts) {
          let entries: any[];
          try {
            entries = await this.fetchAllTranscriptEntries(transcript.name!);
          } catch {
            continue;
          }

          for (const entry of entries) {
            const text = (entry.text || "").toLowerCase();
            if (!text.includes(q)) continue;

            const rawText = entry.text || "";
            const idx = rawText.toLowerCase().indexOf(q);
            const start = Math.max(0, idx - excerptLength / 2);
            const end = Math.min(
              rawText.length,
              idx + q.length + excerptLength / 2
            );
            const excerpt =
              (start > 0 ? "…" : "") +
              rawText.slice(start, end).trim() +
              (end < rawText.length ? "…" : "");

            matchingExcerpts.push({
              excerpt,
              startTime: entry.startTime || undefined,
            });
          }
        }

        if (matchingExcerpts.length > 0) {
          results.push({
            conferenceRecord: parent,
            startTime: record.startTime,
            endTime: record.endTime,
            matches: matchingExcerpts.slice(0, 5),
          });
        }
      }

      if (results.length === 0) {
        return `No meetings found where the transcript contains "${query}".`;
      }

      const output = results
        .map((r) => {
          const header = `Meeting: ${r.conferenceRecord}\n  Start: ${r.startTime ?? "N/A"}  End: ${r.endTime ?? "N/A"}`;
          const matchLines = r.matches
            .map(
              (m) =>
                `  - ${m.startTime ? `[${m.startTime}] ` : ""}${m.excerpt}`
            )
            .join("\n");
          return `${header}\n${matchLines}`;
        })
        .join("\n\n");

      return output;
    } catch (error) {
      throw new Error(
        `Failed to search transcripts: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
