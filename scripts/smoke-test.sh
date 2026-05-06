#!/usr/bin/env bash
# PrintMRP backend smoke test.
#
# Walks through the full flow:
#   - admin login
#   - customer signup
#   - create a sample
#   - record a payment
#   - admin verifies the payment
#   - record a print run
#   - admin dashboard
#
# Run after `npm run dev` is up. Stops at the first failure.
#
# Usage:
#   bash scripts/smoke-test.sh                    # uses http://localhost:4000
#   API=http://localhost:4000 bash scripts/smoke-test.sh

set -euo pipefail

API="${API:-http://localhost:4000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@printmrp.app}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"

cyan()   { printf '\033[36m%s\033[0m\n' "$*"; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
red()    { printf '\033[31m%s\033[0m\n' "$*"; }

require() {
  command -v "$1" >/dev/null 2>&1 || {
    red "Missing $1 — please install it. On macOS: 'brew install $1'."
    exit 1
  }
}
require curl
require jq

cyan "→ /health"
curl -sf "$API/health" | jq -c .
echo

cyan "→ admin login"
ADMIN_RESP=$(curl -sf -X POST "$API/api/auth/admin/login" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
ADMIN_TOKEN=$(echo "$ADMIN_RESP" | jq -r .token)
[ -n "$ADMIN_TOKEN" ] && [ "$ADMIN_TOKEN" != "null" ] || { red "admin login failed"; exit 1; }
green "admin token acquired"

cyan "→ customer signup"
RAND=$(date +%s)
CUST_EMAIL="smoke+$RAND@example.com"
CUST_RESP=$(curl -sf -X POST "$API/api/auth/signup" \
  -H 'content-type: application/json' \
  -d "{\"name\":\"Smoke Tester\",\"email\":\"$CUST_EMAIL\",\"password\":\"hunter2!\",\"organization\":\"QA\"}")
CUST_TOKEN=$(echo "$CUST_RESP" | jq -r .token)
[ -n "$CUST_TOKEN" ] && [ "$CUST_TOKEN" != "null" ] || { red "signup failed: $CUST_RESP"; exit 1; }
green "customer signed up: $CUST_EMAIL"

cyan "→ create sample"
SAMPLE=$(curl -sf -X POST "$API/api/samples" \
  -H "authorization: Bearer $CUST_TOKEN" -H 'content-type: application/json' \
  -d '{
    "name":"Smoke sample",
    "description":"created by smoke test",
    "width":70, "height":40,
    "fields":[
      {"id":"f1","kind":"product","label":"Product","columnKey":"product"},
      {"id":"f2","kind":"mrp","label":"MRP","columnKey":"mrp"},
      {"id":"f3","kind":"barcode","label":"Barcode","columnKey":"sku"},
      {"id":"f4","kind":"qrcode","label":"QR","columnKey":"sku"}
    ]
  }')
SAMPLE_ID=$(echo "$SAMPLE" | jq -r .id)
green "sample created: $SAMPLE_ID"

cyan "→ list samples (should contain it)"
curl -sf "$API/api/samples" -H "authorization: Bearer $CUST_TOKEN" | jq 'length'

cyan "→ record a payment (Khalti, 3 months)"
PAY=$(curl -sf -X POST "$API/api/payments" \
  -H "authorization: Bearer $CUST_TOKEN" -H 'content-type: application/json' \
  -d '{"amount":2599,"method":"khalti","planMonths":3}')
PAY_ID=$(echo "$PAY" | jq -r .id)
green "payment recorded: $PAY_ID  status=$(echo "$PAY" | jq -r .status)"

cyan "→ admin verifies payment"
curl -sf -X PUT "$API/api/admin/payments/$PAY_ID" \
  -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"status":"verified"}' | jq -c '{id, status, verifiedAt}'

cyan "→ record a print run"
curl -sf -X POST "$API/api/prints" \
  -H "authorization: Bearer $CUST_TOKEN" -H 'content-type: application/json' \
  -d "{\"sampleId\":\"$SAMPLE_ID\",\"sampleName\":\"Smoke sample\",\"labelCount\":42}" \
  | jq -c '.user | {id, totalPrints}'

cyan "→ admin dashboard"
curl -sf "$API/api/admin/dashboard" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  | jq '.counts, .revenue, .totalPrints'

echo
green "✅ All smoke tests passed."
