#!/bin/bash

# Exit on error
set -e

# BRANCH_TO_DEPLOY is required (e.g. main, or feature branch name)
# HEROKU_APP is optional (default: google-mcp-dev)
BRANCH_TO_DEPLOY="${1:-}"
HEROKU_APP="${2:-google-mcp-dev}"
if [ -z "$BRANCH_TO_DEPLOY" ]; then
    echo "Usage: $0 <BRANCH_TO_DEPLOY> [HEROKU_APP]"
    echo "Example: $0 main"
    echo "Example: $0 main google-mcp"
    exit 1
fi

# Check for Heroku CLI
if ! command -v heroku &> /dev/null
then
    echo "Heroku CLI not found. Please install it first."
    exit 1
fi

# Login to Heroku (if not already logged in; skip when HEROKU_API_KEY is set for CI)
if [ -z "${HEROKU_API_KEY:-}" ]; then
    heroku whoami &> /dev/null || heroku login
fi

# Create Procfile if it doesn't exist
if [ ! -f Procfile ]; then
    echo 'web: npm run dev -- --multiuser --transport http' > Procfile
    echo "Created Procfile."
fi

# Set Heroku remote to target app
heroku git:remote -a "$HEROKU_APP"

# Ensure Node.js buildpack is set
heroku buildpacks:set heroku/nodejs -a "$HEROKU_APP" || true

# Commit Procfile if needed
if [ -n "$(git status --porcelain Procfile)" ]; then
    git add Procfile
    git commit -m "Update Procfile for Heroku deployment"
fi

# Commit package.json if needed (for tsx dependency)
if [ -n "$(git status --porcelain package.json)" ]; then
    git add package.json
    git commit -m "Add tsx dependency for TypeScript execution"
fi

# Push to Heroku
git push heroku $BRANCH_TO_DEPLOY:main

echo "Deployment to Heroku app '$HEROKU_APP' initiated."