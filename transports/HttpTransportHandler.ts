import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";
import { randomUUID } from "crypto";
import { sessionStorage } from "../utils/helper.js";

export interface HttpTransportConfig {
  port?: number;
  host?: string;
}

export class HttpTransportHandler {
  constructor(private server: Server, private config: HttpTransportConfig = {}) {}

  async connect(): Promise<void> {
    const port = this.config.port ?? parseInt(process.env.PORT || '3000', 10);
    const host = this.config.host ?? '0.0.0.0';

    // Create a single transport instance that will be shared
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true  // Use JSON responses instead of SSE streams
    });

    await this.server.connect(transport);

    const httpServer = http.createServer(async (req, res) => {
        console.log(`Received request: ${req.method} ${req.url}`);
        
        // Set proper HTTP headers for connection management
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        
        // Set up request timeout (25 seconds to be safe with Heroku's 30s limit)
        const timeout = setTimeout(() => {
            if (!res.headersSent) {
                console.log(`Request timeout for ${req.method} ${req.url}`);
                res.writeHead(408, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32000,
                        message: 'Request timeout',
                    },
                    id: null
                }));
            }
        }, 25000); // 25 second timeout
        
        // Capture original end method to log response and clear timeout
        const originalEnd = res.end;
        res.end = function(chunk?: any, encoding?: any, cb?: any) {
            clearTimeout(timeout);
            const context = sessionStorage.getStore();
            const sessionPrefix = context?.sessionId ? `[${context.sessionId}] ` : '';
            console.log(`${sessionPrefix}Response: ${req.method} ${req.url} - Status: ${res.statusCode}`);
            return originalEnd.call(this, chunk, encoding, cb);
        };

        // Clean up timeout on request close/error
        req.on('close', () => {
            clearTimeout(timeout);
            console.log(`Request closed: ${req.method} ${req.url}`);
        });
        req.on('error', (error) => {
            clearTimeout(timeout);
            console.log(`Request error: ${req.method} ${req.url}`, error.message);
        });

        // Slack does not have a metadata endpoint to discover OAuth2 URLs.
        // So creating a proxy endpoint for the Slack OAuth2 URLs.
        // This is used by the Keyring to discover the OAuth2 URLs.
        if (req.method === 'GET' && req.url === '/.well-known/openid-configuration') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                "issuer": "https://accounts.google.com",
                "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline",
                "device_authorization_endpoint": "https://oauth2.googleapis.com/device/code",
                "token_endpoint": "https://oauth2.googleapis.com/token?access_type=offline",
                "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
                "revocation_endpoint": "https://oauth2.googleapis.com/revoke",
                "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
                "response_types_supported": [
                  "code",
                  "token",
                  "id_token",
                  "code token",
                  "code id_token",
                  "token id_token",
                  "code token id_token",
                  "none"
                ],
                "subject_types_supported": [
                  "public"
                ],
                "id_token_signing_alg_values_supported": [
                  "RS256"
                ],
                "scopes_supported": [
                  "openid",
                  "email",
                  "profile"
                ],
                "token_endpoint_auth_methods_supported": [
                  "client_secret_post",
                  "client_secret_basic"
                ],
                "claims_supported": [
                  "aud",
                  "email",
                  "email_verified",
                  "exp",
                  "family_name",
                  "given_name",
                  "iat",
                  "iss",
                  "name",
                  "picture",
                  "sub"
                ],
                "code_challenge_methods_supported": [
                  "plain",
                  "S256"
                ],
                "grant_types_supported": [
                  "authorization_code",
                  "refresh_token",
                  "urn:ietf:params:oauth:grant-type:device_code",
                  "urn:ietf:params:oauth:grant-type:jwt-bearer"
                ]
              }
            ));
            return;
        }
        
        if (req.method === 'GET' && req.url === '/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                status: 'healthy',
                server: 'google-mcp',
                version: '0.0.1',
                timestamp: new Date().toISOString()
            }));
            return;
        }

        try {
            const sessionId = (req.headers?.['mcp-session-id'] as string) ?? randomUUID();
            
            await sessionStorage.run({ sessionId }, async () => {
                await transport.handleRequest(req, res);
            });
            
        } catch (error) {
            clearTimeout(timeout);
            console.error(`Error handling request ${req.method} ${req.url}:`, error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    },
                    id: null
                }));
            }
        }
    });

    // Configure server settings for better connection handling
    httpServer.keepAliveTimeout = 5000; // 5 seconds
    httpServer.headersTimeout = 6000; // 6 seconds  
    httpServer.timeout = 30000; // 30 seconds total timeout
    httpServer.maxHeadersCount = 100;
    
    httpServer.listen(port, host, () => {
        console.log(`Google MCP Server listening on http://${host}:${port}/mcp`);
    });

    // Handle server errors
    httpServer.on('error', (error) => {
        console.error('HTTP Server error:', error);
    });

    // Handle client errors
    httpServer.on('clientError', (error, socket) => {
        console.error('Client error:', error.message);
        if (!socket.destroyed) {
            socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        }
    });
  }
} 