#!/bin/sh
# Runtime environment variable injection for frontend

# Default API URL if not provided
API_URL="${VITE_API_URL:-http://localhost:8001}"

# Replace placeholder in built JS files
find /usr/share/nginx/html -name '*.js' -exec sed -i "s|__API_URL_PLACEHOLDER__|${API_URL}|g" {} \;

# Start nginx
exec nginx -g 'daemon off;'
