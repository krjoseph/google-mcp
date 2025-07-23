import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import http from "http";

export interface HttpTransportConfig {
  port?: number;
  host?: string;
}

export class HttpTransportHandler {
  constructor(private server: Server, private config: HttpTransportConfig = {}) {}

  async connect(): Promise<void> {
    const port = this.config.port ?? parseInt(process.env.PORT || '3000', 10);
    const host = this.config.host ?? '0.0.0.0';

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    await this.server.connect(transport);

    const httpServer = http.createServer(async (req, res) => {
        console.log(`Received request: ${req.method} ${req.url}`);
        
        // Capture original end method to log response
        const originalEnd = res.end;
        res.end = function(chunk?: any, encoding?: any, cb?: any) {
            console.log(`Response: ${req.method} ${req.url} - Status: ${res.statusCode}`);
            return originalEnd.call(this, chunk, encoding, cb);
        };

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
            await transport.handleRequest(req, res);
        } catch (error) {
            console.error(error);
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    jsonrpc: '2.0',
                    error: {
                        code: -32603,
                        message: 'Internal server error',
                    }
                }));
            }
        }
    });

    httpServer.listen(port, host, () => {
        console.log(`Google MCP Server listening on http://${host}:${port}/mcp`);
    });
  }
} 