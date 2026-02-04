import { google } from "googleapis";
import { timeApiCall } from "./helper.js";

export interface ListOfDocuments {
      name: string;
      type: string;
      link: string;
      size: string;
}

export default class GoogleDrive {
  private drive: any;
  private docs: any;
  private sheets: any;

  constructor(authClient: any) {
    this.drive = google.drive({ version: "v3", auth: authClient });
    this.docs = google.docs({ version: "v1", auth: authClient });
    this.sheets = google.sheets({ version: "v4", auth: authClient });
  }

  async listFiles(
    query?: string,
    pageSize: number = 10,
    orderBy?: string,
    fields?: string
  ) {
    try {
      const buildQuery = (rawQuery?: string) => {
        const baseFilter = "trashed = false";
        if (!rawQuery || rawQuery.trim().length === 0) {
          return baseFilter;
        }

        const trimmed = rawQuery.trim();
        const hasOperators = /[=<>]/.test(trimmed);
        const hasKeywords = /\b(contains|in|has|not|and|or)\b/i.test(trimmed);
        const isSimple = !hasOperators && !hasKeywords;
        const escaped = trimmed.replace(/'/g, "\\'");
        const userQuery = isSimple ? `name contains '${escaped}'` : trimmed;

        if (/\btrashed\b/i.test(userQuery)) {
          return userQuery;
        }

        return `${userQuery} and ${baseFilter}`;
      };

      const response: any = await timeApiCall(
        "Drive.listFiles",
        () => this.drive.files.list({
          q: buildQuery(query),
          pageSize: pageSize,
          orderBy: orderBy || "modifiedTime desc",
          fields:
            fields ||
            "files(id, name, mimeType, modifiedTime, size, webViewLink)",
        })
      );

      if (!response.data.files || response.data.files.length === 0) {
        return "No files found.";
      }

      return JSON.stringify(response.data.files);
    } catch (error) {
      throw new Error(
        `Failed to list files: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async getFileContent(fileId: string) {
    try {
      // First get the file metadata to check its type
      const fileMetadata: any = await timeApiCall(
        "Drive.getFileMetadata",
        () => this.drive.files.get({
          fileId: fileId,
          fields: "name,mimeType",
        })
      );

      const { name, mimeType } = fileMetadata.data;

      // Handle text files directly
      if (
        mimeType === "text/plain" ||
        mimeType === "application/json" ||
        mimeType.includes("text/") ||
        mimeType.includes("application/javascript")
      ) {
        const response: any = await timeApiCall(
          "Drive.getFileContent",
          () => this.drive.files.get({
            fileId: fileId,
            alt: "media",
          })
        );

        return `File: ${name}\nContent:\n\n${response.data}`;
      }

      // For Google Docs, get the content as plain text
      else if (
        mimeType === "application/vnd.google-apps.document" ||
        mimeType === "application/vnd.google-apps.spreadsheet"
      ) {
        let exportMimeType = "text/plain";
        if (mimeType === "application/vnd.google-apps.spreadsheet") {
          exportMimeType = "text/csv";
        }

        const response: any = await timeApiCall(
          "Drive.exportFile",
          () => this.drive.files.export({
            fileId: fileId,
            mimeType: exportMimeType,
          })
        );

        return `File: ${name}\nContent (exported as ${exportMimeType}):\n\n${response.data}`;
      }

      // For other file types, just return metadata
      else {
        return `File: ${name}\nType: ${mimeType}\nThis file type cannot be displayed as text. You can access it via Google Drive directly.`;
      }
    } catch (error) {
      throw new Error(
        `Failed to get file content: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async createFile(
    name: string,
    content: string,
    mimeType: string = "text/plain",
    folderId?: string
  ) {
    try {
      const fileMetadata: any = {
        name: name,
        mimeType: mimeType,
      };

      if (folderId) {
        fileMetadata.parents = [folderId];
      }

      // If creating a Google Doc, Spreadsheet, etc.
      if (mimeType.includes("application/vnd.google-apps")) {
        const response: any = await timeApiCall(
          "Drive.createGoogleAppsFile",
          () => this.drive.files.create({
            requestBody: fileMetadata,
            fields: "id,name,webViewLink",
            mimeType: mimeType,
          })
        );

        const { id, webViewLink } = response.data;

        // If creating a Google Document and content is provided, insert it
        if (mimeType === "application/vnd.google-apps.document" && content) {
          const requests: any[] = [
            {
              insertText: {
                text: content,
                endOfSegmentLocation: {
                  segmentId: "",
                },
              },
            },
          ];

          // If mimeType parameter suggests markdown, apply code block styling
          // Note: We check the content parameter's mimeType hint, but for now
          // we'll insert as plain text. Markdown styling can be added if needed.

          await timeApiCall(
            "Docs.insertContentIntoDocument",
            () => this.docs.documents.batchUpdate({
              documentId: id,
              requestBody: {
                requests: requests,
              },
            })
          );
        }

        return `Created ${mimeType} with name: ${name}\nID: ${id}\nLink: ${webViewLink}`;
      }

      // For regular files with content
      const response: any = await timeApiCall(
        "Drive.createFile",
        () => this.drive.files.create({
          requestBody: fileMetadata,
          media: {
            mimeType: mimeType,
            body: content,
          },
          fields: "id,name,webViewLink",
        })
      );

      const { id, webViewLink } = response.data;
      return `Created file with name: ${name}\nID: ${id}\nLink: ${
        webViewLink || "N/A"
      }`;
    } catch (error) {
      throw new Error(
        `Failed to create file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async updateFile(fileId: string, content: string, mimeType?: string) {
    try {
      // First get the file metadata to verify its type
      const fileMetadata: any = await timeApiCall(
        "Drive.getFileMetadataForUpdate",
        () => this.drive.files.get({
          fileId: fileId,
          fields: "name,mimeType",
        })
      );

      const { mimeType: fileMimeType } = fileMetadata.data;

      // Check if this is a Google Doc/Sheet - these require different update approach
      if (fileMimeType.includes("application/vnd.google-apps")) {
        throw new Error(
          `Updating Google ${fileMimeType
            .split(".")
            .pop()} content is not supported via this tool. Please use the Google Drive web interface.`
        );
      }

      // Update regular file content
      const response: any = await timeApiCall(
        "Drive.updateFile",
        () => this.drive.files.update({
          fileId: fileId,
          media: {
            mimeType: mimeType || fileMimeType,
            body: content,
          },
          fields: "id,name",
        })
      );

      return `File '${response.data.name}' updated successfully.`;
    } catch (error) {
      throw new Error(
        `Failed to update file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async appendToFile(fileId: string, content: string, mimeType?: string) {
    try {
      // First get the file metadata to verify its type
      const fileMetadata: any = await timeApiCall(
        "Drive.getFileMetadataForAppend",
        () => this.drive.files.get({
          fileId: fileId,
          fields: "name,mimeType",
        })
      );

      const { name: fileName, mimeType: fileMimeType } = fileMetadata.data;

      // Handle Google Docs
      if (fileMimeType === "application/vnd.google-apps.document") {
        // Get the document to find the end index
        const doc: any = await timeApiCall(
          "Docs.getDocument",
          () => this.docs.documents.get({
            documentId: fileId,
          })
        );

        const endIndex = doc.data.body.content[doc.data.body.content.length - 1].endIndex - 1;

        const requests: any[] = [
          {
            insertText: {
              text: content,
              endOfSegmentLocation: {
                segmentId: "",
              },
            },
          },
        ];

        // If mimeType is markdown, apply code block styling
        if (mimeType === 'text/markdown') {
          requests.push({
            updateTextStyle: {
              range: {
                startIndex: endIndex,
                endIndex: endIndex + content.length,
              },
              textStyle: {
                weightedFontFamily: {
                  fontFamily: "Courier New",
                },
                fontSize: {
                  magnitude: 10,
                  unit: "PT",
                },
              },
              fields: "weightedFontFamily,fontSize",
            },
          });
        }

        const response: any = await timeApiCall(
          "Docs.appendToDocument",
          () => this.docs.documents.batchUpdate({
            documentId: fileId,
            requestBody: {
              requests: requests,
            },
          })
        );

        return `Content appended to Google Doc '${fileName}' successfully.`;
      }

      // Handle Google Sheets
      if (fileMimeType === "application/vnd.google-apps.spreadsheet") {
        // Split content by lines to append as rows
        const lines = content.split("\n").filter(line => line.trim() !== "");
        const values = lines.map(line => [line]);

        const response: any = await timeApiCall(
          "Sheets.appendToSpreadsheet",
          () => this.sheets.spreadsheets.values.append({
            spreadsheetId: fileId,
            range: "A1",
            valueInputOption: "RAW",
            requestBody: {
              values: values,
            },
          })
        );

        return `${lines.length} row(s) appended to Google Sheet '${fileName}' successfully.`;
      }

      // Handle other Google Apps files
      if (fileMimeType.includes("application/vnd.google-apps")) {
        throw new Error(
          `Appending to Google ${fileMimeType
            .split(".")
            .pop()} is not supported. Only Google Docs and Sheets are supported.`
        );
      }

      // Read the existing file content
      const existingContent: any = await timeApiCall(
        "Drive.getFileContent",
        () => this.drive.files.get({
          fileId: fileId,
          alt: "media",
        })
      );

      // Append new content to existing content
      const combinedContent = existingContent.data + content;

      // Update file with combined content
      const response: any = await timeApiCall(
        "Drive.updateFile",
        () => this.drive.files.update({
          fileId: fileId,
          media: {
            mimeType: fileMimeType,
            body: combinedContent,
          },
          fields: "id,name",
        })
      );

      return `File '${response.data.name}' updated successfully.`;
    } catch (error) {
      throw new Error(
        `Failed to update file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async deleteFile(fileId: string, permanently: boolean = false) {
    try {
      if (permanently) {
        await timeApiCall(
          "Drive.deleteFilePermanently",
          () => this.drive.files.delete({
            fileId: fileId,
          })
        );
        return `File with ID ${fileId} permanently deleted.`;
      } else {
        await timeApiCall(
          "Drive.trashFile",
          () => this.drive.files.update({
            fileId: fileId,
            requestBody: {
              trashed: true,
            },
          })
        );
        return `File with ID ${fileId} moved to trash.`;
      }
    } catch (error) {
      throw new Error(
        `Failed to delete file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async shareFile(
    fileId: string,
    emailAddress: string,
    role: string = "reader",
    sendNotification: boolean = true,
    message?: string
  ) {
    try {
      const response: any = await timeApiCall(
        "Drive.createPermission",
        () => this.drive.permissions.create({
          fileId: fileId,
          requestBody: {
            type: "user",
            role: role,
            emailAddress: emailAddress,
          },
          sendNotificationEmail: sendNotification,
          emailMessage: message,
        })
      );

      // Get the file name
      const fileMetadata: any = await timeApiCall(
        "Drive.getFileNameForShare",
        () => this.drive.files.get({
          fileId: fileId,
          fields: "name",
        })
      );

      return `File '${fileMetadata.data.name}' shared with ${emailAddress} as ${role}.`;
    } catch (error) {
      throw new Error(
        `Failed to share file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
