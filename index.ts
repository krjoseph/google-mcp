#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import GoogleCalendar from "./utils/calendar";
import GoogleGmail from "./utils/gmail";
import GoogleDrive from "./utils/drive";
import GoogleTasks from "./utils/tasks";
import { getToolsForScopes } from "./tools";
import { createAuthClient, extractAuthToken } from "./utils/auth";
import {
  // Calendar validators
  isCreateEventArgs,
  isGetEventsArgs,
  isSetDefaultCalendarArgs,
  isListCalendarsArgs,
  isGetEventArgs,
  isUpdateEventArgs,
  isDeleteEventArgs,
  isFindFreeTimeArgs,
  // Gmail validators
  isListLabelsArgs,
  isListEmailsArgs,
  isGetEmailArgs,
  isSendEmailArgs,
  isDraftEmailArgs,
  isDeleteEmailArgs,
  isModifyLabelsArgs,
  isGetEmailByIndexArgs,
  // Drive validators
  isListFilesArgs,
  isGetFileContentArgs,
  isCreateFileArgs,
  isUpdateFileArgs,
  isDeleteFileArgs,
  isShareFileArgs,
  // Tasks validators
  isSetDefaultTaskListArgs,
  isListTaskListsArgs,
  isListTasksArgs,
  isGetTaskArgs,
  isCreateTaskArgs,
  isUpdateTaskArgs,
  isCompleteTaskArgs,
  isDeleteTaskArgs,
  isCreateTaskListArgs,
  isDeleteTaskListArgs,
} from "./utils/helper";
import { ClientManager } from "./utils/client-manager";
import { StdioTransportHandler } from "./transports/StdioTransportHandler";
import { HttpTransportHandler, type HttpTransportConfig } from "./transports/HttpTransportHandler";

export let MULTIUSER_MODE = false;
if (process.argv.includes('--multiuser')) {
  console.log('Multiuser mode enabled');
  MULTIUSER_MODE = true;
}

let TRANSPORT: 'stdio' | 'http' = 'stdio';
const transportArgIndex = process.argv.findIndex(arg => arg === '--transport');
if (transportArgIndex !== -1 && process.argv[transportArgIndex + 1]) {
  const value = process.argv[transportArgIndex + 1];
  if (value === 'http' || value === 'stdio') {
    TRANSPORT = value;
  } else {
    console.warn(`Unknown transport '${value}', defaulting to stdio.`);
  }
}

// Parse port argument for HTTP transport
let HTTP_PORT: number | undefined;
const portArgIndex = process.argv.findIndex(arg => arg === '--port');
if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
  const portValue = parseInt(process.argv[portArgIndex + 1], 10);
  if (!isNaN(portValue) && portValue > 0 && portValue <= 65535) {
    HTTP_PORT = portValue;
  } else {
    console.warn(`Invalid port '${process.argv[portArgIndex + 1]}', using default port 3000.`);
  }
}

let clientManager: ClientManager;
let initializationPromise: Promise<void>;

// Initialize the MCP server
const server = new Server(
  { name: "Google MCP Server", version: "0.0.1" },
  { capabilities: { tools: {} } }
);

// Handle the "list tools" request
server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  const scopes = (request?.params?.scope as string)?.split(" ");
  console.log(`Requesting tools for scopes: ${scopes ? JSON.stringify(scopes): "<all>"}`);
  const tools = getToolsForScopes(scopes);
  return { tools };
});

// Handle the "call tool" request
server.setRequestHandler(CallToolRequestSchema, async (request, context) => {
  try {
    const authToken = await extractAuthToken(context?.requestInfo?.headers?.authorization);

    if (!MULTIUSER_MODE) {
      await initializationPromise;

      if (!clientManager ||
        !clientManager.getGoogleCalendarInstance() ||
        !clientManager.getGoogleGmailInstance() ||
        !clientManager.getGoogleDriveInstance() ||
        !clientManager.getGoogleTasksInstance()
      ) {
        throw new Error("Authentication failed to initialize services");
      }
    }

    const { name, arguments: args } = request.params;
    if (!args) throw new Error("No arguments provided");

    console.log(`Calling tool: ${name} with args ${JSON.stringify(args)}`);

    switch (name) {
      // Calendar tools handlers
      case "google_calendar_set_default": {
        if (!isSetDefaultCalendarArgs(args)) {
          throw new Error("Invalid arguments for google_calendar_set_default");
        }
        const { calendarId } = args;
        const result = (await clientManager.getGoogleCalendarInstance(authToken)).setDefaultCalendarId(calendarId);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_calendar_list_calendars": {
        if (!isListCalendarsArgs(args)) {
          throw new Error(
            "Invalid arguments for google_calendar_list_calendars"
          );
        }
        const calendars = await (await clientManager.getGoogleCalendarInstance(authToken)).listCalendars();
        const formattedResult = calendars
          .map(
            (cal: any) =>
              `${cal.summary}${cal.primary ? " (Primary)" : ""} - ID: ${cal.id}`
          )
          .join("\n");

        return {
          content: [{ type: "text", text: formattedResult }],
          isError: false,
        };
      }

      case "google_calendar_create_event": {
        if (!isCreateEventArgs(args)) {
          throw new Error("Invalid arguments for google_calendar_create_event");
        }

        const {
          summary,
          start,
          end,
          calendarId,
          description,
          location,
          colorId,
          attendees,
          recurrence,
        } = args;

        if (!summary || !start || !end)
          throw new Error("Missing required arguments");

        const result = await (await clientManager.getGoogleCalendarInstance(authToken)).createEvent(
          summary,
          start,
          end,
          calendarId,
          description,
          location,
          colorId,
          attendees,
          recurrence
        );

        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_calendar_get_events": {
        if (!isGetEventsArgs(args)) {
          throw new Error("Invalid arguments for google_calendar_get_events");
        }
        const { limit, calendarId, timeMin, timeMax, q, showDeleted } = args;
        const result = await (await clientManager.getGoogleCalendarInstance(authToken)).getEvents(
          limit || 10,
          calendarId,
          timeMin,
          timeMax,
          q,
          showDeleted
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_calendar_get_event": {
        if (!isGetEventArgs(args)) {
          throw new Error("Invalid arguments for google_calendar_get_event");
        }
        const { eventId, calendarId } = args;
        const result = await (await clientManager.getGoogleCalendarInstance(authToken)).getEvent(
          eventId,
          calendarId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_calendar_update_event": {
        if (!isUpdateEventArgs(args)) {
          throw new Error("Invalid arguments for google_calendar_update_event");
        }

        const {
          eventId,
          calendarId,
          summary,
          description,
          start,
          end,
          location,
          colorId,
          attendees,
          recurrence,
        } = args;

        const changes = {
          summary,
          description,
          start,
          end,
          location,
          colorId,
          attendees,
          recurrence,
        };

        const result = await (await clientManager.getGoogleCalendarInstance(authToken)).updateEvent(
          eventId,
          changes,
          calendarId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_calendar_delete_event": {
        if (!isDeleteEventArgs(args)) {
          throw new Error("Invalid arguments for google_calendar_delete_event");
        }

        const { eventId, calendarId } = args;
        const result = await (await clientManager.getGoogleCalendarInstance(authToken)).deleteEvent(
          eventId,
          calendarId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_calendar_find_free_time": {
        if (!isFindFreeTimeArgs(args)) {
          throw new Error(
            "Invalid arguments for google_calendar_find_free_time"
          );
        }

        const { startDate, endDate, duration, calendarIds } = args;
        const result = await (await clientManager.getGoogleCalendarInstance(authToken)).findFreeTime(
          startDate,
          endDate,
          duration,
          calendarIds
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      // Gmail tools handlers
      case "google_gmail_list_labels": {
        if (!isListLabelsArgs(args)) {
          throw new Error("Invalid arguments for google_gmail_list_labels");
        }
        const labels = await (await clientManager.getGoogleGmailInstance(authToken)).listLabels();
        const formattedResult = labels
          .map(
            (label: any) => `${label.name} - ID: ${label.id} (${label.type})`
          )
          .join("\n");
        return {
          content: [{ type: "text", text: formattedResult }],
          isError: false,
        };
      }

      case "google_gmail_list_emails": {
        if (!isListEmailsArgs(args)) {
          throw new Error("Invalid arguments for google_gmail_list_emails");
        }
        const { labelIds, maxResults, query } = args;
        const result = await (await clientManager.getGoogleGmailInstance(authToken)).listEmails(
          labelIds,
          maxResults,
          query
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_gmail_get_email": {
        if (!isGetEmailArgs(args)) {
          throw new Error("Invalid arguments for google_gmail_get_email");
        }
        const { messageId, format } = args;
        const result = await (await clientManager.getGoogleGmailInstance(authToken)).getEmail(messageId, format);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_gmail_get_email_by_index": {
        if (!isGetEmailByIndexArgs(args)) {
          throw new Error(
            "Invalid arguments for google_gmail_get_email_by_index"
          );
        }
        const { index, format } = args;
        try {
          const messageId = (await clientManager.getGoogleGmailInstance(authToken)).getMessageIdByIndex(index);
          const result = await (await clientManager.getGoogleGmailInstance(authToken)).getEmail(messageId, format);
          return {
            content: [{ type: "text", text: result }],
            isError: false,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text: `Error: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              },
            ],
            isError: true,
          };
        }
      }

      case "google_gmail_send_email": {
        if (!isSendEmailArgs(args)) {
          throw new Error("Invalid arguments for google_gmail_send_email");
        }
        const { to, subject, body, cc, bcc, isHtml } = args;
        const result = await (await clientManager.getGoogleGmailInstance(authToken)).sendEmail(
          to,
          subject,
          body,
          cc,
          bcc,
          isHtml
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_gmail_draft_email": {
        if (!isDraftEmailArgs(args)) {
          throw new Error("Invalid arguments for google_gmail_draft_email");
        }
        const { to, subject, body, cc, bcc, isHtml } = args;
        const result = await (await clientManager.getGoogleGmailInstance(authToken)).draftEmail(
          to,
          subject,
          body,
          cc,
          bcc,
          isHtml
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_gmail_delete_email": {
        if (!isDeleteEmailArgs(args)) {
          throw new Error("Invalid arguments for google_gmail_delete_email");
        }
        const { messageId, permanently } = args;
        const result = await (await clientManager.getGoogleGmailInstance(authToken)).deleteEmail(
          messageId,
          permanently
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_gmail_modify_labels": {
        if (!isModifyLabelsArgs(args)) {
          throw new Error("Invalid arguments for google_gmail_modify_labels");
        }
        const { messageId, addLabelIds, removeLabelIds } = args;
        const result = await (await clientManager.getGoogleGmailInstance(authToken)).modifyLabels(
          messageId,
          addLabelIds,
          removeLabelIds
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      // Google Drive tools handlers
      case "google_drive_list_files": {
        if (!isListFilesArgs(args)) {
          throw new Error("Invalid arguments for google_drive_list_files");
        }
        const { query, pageSize, orderBy, fields } = args;
        const result = await (await clientManager.getGoogleDriveInstance(authToken)).listFiles(
          query,
          pageSize,
          orderBy,
          fields
        );

        if (!result?.length) {
          return {
            content: [{ type: "text", text: "No files found" }],
            isError: false,
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify({
              data: result,
              _type: "listOfDocuments",
            })
          }],
          isError: false,
        };
      }

      case "google_drive_get_file_content": {
        if (!isGetFileContentArgs(args)) {
          throw new Error(
            "Invalid arguments for google_drive_get_file_content"
          );
        }
        const { fileId } = args;
        const result = await (await clientManager.getGoogleDriveInstance(authToken)).getFileContent(fileId);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_drive_create_file": {
        if (!isCreateFileArgs(args)) {
          throw new Error("Invalid arguments for google_drive_create_file");
        }
        const { name, content, mimeType, folderId } = args;
        const result = await (await clientManager.getGoogleDriveInstance(authToken)).createFile(
          name,
          content,
          mimeType,
          folderId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_drive_update_file": {
        if (!isUpdateFileArgs(args)) {
          throw new Error("Invalid arguments for google_drive_update_file");
        }
        const { fileId, content, mimeType } = args;
        const result = await (await clientManager.getGoogleDriveInstance(authToken)).updateFile(
          fileId,
          content,
          mimeType
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_drive_delete_file": {
        if (!isDeleteFileArgs(args)) {
          throw new Error("Invalid arguments for google_drive_delete_file");
        }
        const { fileId, permanently } = args;
        const result = await (await clientManager.getGoogleDriveInstance(authToken)).deleteFile(
          fileId,
          permanently
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_drive_share_file": {
        if (!isShareFileArgs(args)) {
          throw new Error("Invalid arguments for google_drive_share_file");
        }
        const { fileId, emailAddress, role, sendNotification, message } = args;
        const result = await (await clientManager.getGoogleDriveInstance(authToken)).shareFile(
          fileId,
          emailAddress,
          role,
          sendNotification,
          message
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      // Google Tasks tools handlers
      case "google_tasks_set_default_list": {
        if (!isSetDefaultTaskListArgs(args)) {
          throw new Error(
            "Invalid arguments for google_tasks_set_default_list"
          );
        }
        const { taskListId } = args;
        const result = (await clientManager.getGoogleTasksInstance(authToken)).setDefaultTaskList(taskListId);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_list_tasklists": {
        if (!isListTaskListsArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_list_tasklists");
        }
        const result = await (await clientManager.getGoogleTasksInstance(authToken)).listTaskLists();
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_list_tasks": {
        if (!isListTasksArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_list_tasks");
        }
        const { taskListId, showCompleted } = args;
        const result = await (await clientManager.getGoogleTasksInstance(authToken)).listTasks(
          taskListId,
          showCompleted
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_get_task": {
        if (!isGetTaskArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_get_task");
        }
        const { taskId, taskListId } = args;
        const result = await (await clientManager.getGoogleTasksInstance()).getTask(taskId, taskListId);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_create_task": {
        if (!isCreateTaskArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_create_task");
        }
        const { title, notes, due, taskListId } = args;
        const result = await (await clientManager.getGoogleTasksInstance(authToken)).createTask(
          title,
          notes,
          due,
          taskListId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_update_task": {
        if (!isUpdateTaskArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_update_task");
        }
        const { taskId, title, notes, due, status, taskListId } = args;
        const result = await (await clientManager.getGoogleTasksInstance(authToken)).updateTask(
          taskId,
          { title, notes, due, status },
          taskListId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_complete_task": {
        if (!isCompleteTaskArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_complete_task");
        }
        const { taskId, taskListId } = args;
        const result = await (await clientManager.getGoogleTasksInstance(authToken)).completeTask(
          taskId,
          taskListId
        );
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_delete_task": {
        if (!isDeleteTaskArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_delete_task");
        }
        const { taskId, taskListId } = args;
        const result = await (await clientManager.getGoogleTasksInstance(authToken)).deleteTask(taskId, taskListId);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_create_tasklist": {
        if (!isCreateTaskListArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_create_tasklist");
        }
        const { title } = args;
        const result = await (await clientManager.getGoogleTasksInstance(authToken)).createTaskList(title);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      case "google_tasks_delete_tasklist": {
        if (!isDeleteTaskListArgs(args)) {
          throw new Error("Invalid arguments for google_tasks_delete_tasklist");
        }
        const { taskListId } = args;
        const result = await (await clientManager.getGoogleTasksInstance(authToken)).deleteTaskList(taskListId);
        return {
          content: [{ type: "text", text: result }],
          isError: false,
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    console.error(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      ],
      isError: true,
    };
  }
});

// Connect the server to the selected transport
if (TRANSPORT === 'http') {
  const httpConfig: HttpTransportConfig = {};
  if (HTTP_PORT !== undefined) {
    httpConfig.port = HTTP_PORT;
  }
  const httpHandler = new HttpTransportHandler(server, httpConfig);
  await httpHandler.connect();
} else {
  // Connect the server to stdio transport
  const stdioHandler = new StdioTransportHandler(server);
  await stdioHandler.connect();
}

if (!MULTIUSER_MODE) {
  initializationPromise = createAuthClient()
    .then((authClient) => {
      clientManager = new ClientManager(
        new GoogleCalendar(authClient),
        new GoogleGmail(authClient),
        new GoogleDrive(authClient),
        new GoogleTasks(authClient)
      );
    })
    .catch((error) => {
      throw error; // This will reject the promise, and tool handlers will reflect the error
    });
} else {
  clientManager = new ClientManager();
}
