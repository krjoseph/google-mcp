import GoogleCalendar from "./calendar.js";
import GoogleGmail from "./gmail.js";
import GoogleDrive from "./drive.js";
import GoogleTasks from "./tasks.js";
import { hashString } from "./helper.js";
import { createAuthClient } from "./auth.js";

export class ClientManager {
  private clients: Map<string, any> = new Map();

  constructor(
    defaultGoogleCalendarInstance?: GoogleCalendar, 
    defaultGoogleGmailInstance?: GoogleGmail, 
    defaultGoogleDriveInstance?: GoogleDrive, 
    defaultGoogleTasksInstance?: GoogleTasks) {
    this.clients = new Map();

    if (defaultGoogleCalendarInstance) {
      this.clients.set("default-google-calendar", defaultGoogleCalendarInstance);
    }
    if (defaultGoogleGmailInstance) {
      this.clients.set("default-google-gmail", defaultGoogleGmailInstance);
    }
    if (defaultGoogleDriveInstance) {
      this.clients.set("default-google-drive", defaultGoogleDriveInstance);
    }
    if (defaultGoogleTasksInstance) {
      this.clients.set("default-google-tasks", defaultGoogleTasksInstance);
    }
  }

  public async getGoogleCalendarInstance(authToken?: string): Promise<GoogleCalendar> {
    if (authToken) {
      const hashedToken = hashString(authToken);

      const client = this.clients.get(`${hashedToken}-google-calendar`);
      if (client) {
        return client;
      }

      const newClient = new GoogleCalendar(await createAuthClient(authToken));
      this.clients.set(`${hashedToken}-google-calendar`, newClient);

      return newClient;
    }
    return this.clients.get("default-google-calendar");
  }

  public async getGoogleGmailInstance(authToken?: string): Promise<GoogleGmail> {
    if (authToken) {
        const hashedToken = hashString(authToken);
  
        const client = this.clients.get(`${hashedToken}-google-gmail`);
        if (client) {
          return client;
        }
  
        const newClient = new GoogleGmail(await createAuthClient(authToken));
        this.clients.set(`${hashedToken}-google-gmail`, newClient);
  
        return newClient;
    }
    return this.clients.get("default-google-gmail");
  }

  public async getGoogleDriveInstance(authToken?: string): Promise<GoogleDrive> {
    if (authToken) {
        const hashedToken = hashString(authToken);
  
        const client = this.clients.get(`${hashedToken}-google-drive`);
        if (client) {
          return client;
        }
  
        const newClient = new GoogleDrive(await createAuthClient(authToken));
        this.clients.set(`${hashedToken}-google-drive`, newClient);
  
        return newClient;
    }
    return this.clients.get("default-google-drive");
  }

  public async getGoogleTasksInstance(authToken?: string): Promise<GoogleTasks> {
    if (authToken) {
        const hashedToken = hashString(authToken);
  
        const client = this.clients.get(`${hashedToken}-google-tasks`);
        if (client) {
          return client;
        }
  
        const newClient = new GoogleTasks(await createAuthClient(authToken));
        this.clients.set(`${hashedToken}-google-tasks`, newClient);
  
        return newClient;
    }
    return this.clients.get("default-google-tasks");
  }
}