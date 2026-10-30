#!/usr/bin/env bash
# Build and publish to https://gitcity.sraas.dev (static files; GitHub is called from the visitor's browser).
set -euo pipefail
TARGET="${DEPLOY_TARGET:-sraas}"
cd "$(dirname "$0")"
npm run build
tar czf - -C dist . | ssh "$TARGET" 'mkdir -p /var/www/gitcity && rm -rf /var/www/gitcity/* && tar xzf - -C /var/www/gitcity && chmod -R a+rX /var/www/gitcity'
echo "> Done: https://gitcity.sraas.dev"
