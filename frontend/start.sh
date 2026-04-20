#!/bin/bash
cd "$(dirname "$0")"
source "$(dirname "$0")/../scripts/ensure-path.sh"
source "$(dirname "$0")/../scripts/check-node.sh"
npm install
npm run dev
