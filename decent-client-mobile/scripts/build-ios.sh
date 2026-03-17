#!/bin/bash
set -e
echo "Building web assets..."
npx vite build
echo "Syncing to iOS..."
npx cap sync ios
echo "Done! Open in Xcode:"
echo "  npx cap open ios"
